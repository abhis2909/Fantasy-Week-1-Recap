import Papa from "papaparse";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Position } from "@/lib/generated/prisma/client";

const POSITIONS = ["C", "LW", "RW", "D", "G"] as const;
const TRUTHY = ["true", "1", "yes", "y"];
const FALSY = ["false", "0", "no", "n"];

export interface ImportResult {
  ok: boolean;
  imported: number;
  errors: string[];
}

const RowSchema = z
  .object({
    team: z.string().trim().min(1, "team is required"),
    player: z.string().trim().min(1, "player is required"),
    position: z.enum(POSITIONS, { message: `position must be one of ${POSITIONS.join(", ")}` }),
    started: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => TRUTHY.includes(v) || FALSY.includes(v), "started must be true/false"),
  })
  .passthrough();

/**
 * Imports a week's per-player stat lines + started/benched snapshot from a
 * CSV with columns: team, player, position, started, plus one column per
 * the league's scoring category codes (only the columns that apply to a
 * given position need values — others are ignored for that row).
 *
 * Deliberately reject-and-explain, all-or-nothing: a row that doesn't
 * resolve to an existing rostered player is an error for the whole upload,
 * not a skipped row — silently dropping a row is a worse failure mode than
 * making the commissioner re-upload a fixed file. New players must be added
 * via a transaction first, so a typo in a name can't quietly create a
 * duplicate "player."
 */
export async function importStatLinesCsv(
  weekId: string,
  csvText: string
): Promise<ImportResult> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: { season: { include: { league: { include: { categories: true } } } } },
  });
  if (!week) return { ok: false, imported: 0, errors: ["Week not found."] };

  const categories = week.season.league.categories;
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      imported: 0,
      errors: parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`),
    };
  }

  const header = parsed.meta.fields ?? [];
  const missing = ["team", "player", "position", "started"].filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      imported: 0,
      errors: [
        `Missing required column(s): ${missing.join(", ")}. Expected columns: team, player, position, started, plus one column per scoring category code (${categories.map((c) => c.code).join(", ")}).`,
      ],
    };
  }

  const errors: string[] = [];
  const validRows: {
    team: string;
    player: string;
    position: Position;
    started: boolean;
    values: Record<string, number>;
  }[] = [];

  parsed.data.forEach((row, i) => {
    const rowNum = i + 2; // header is row 1
    const result = RowSchema.safeParse(row);
    if (!result.success) {
      errors.push(`Row ${rowNum}: ${result.error.issues.map((iss) => iss.message).join("; ")}`);
      return;
    }
    const started = TRUTHY.includes(result.data.started);
    const values: Record<string, number> = {};
    for (const cat of categories) {
      if (!cat.appliesTo.includes(result.data.position as Position)) continue;
      const raw = row[cat.code];
      if (raw === undefined || raw.trim() === "") {
        values[cat.code] = 0;
        continue;
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        errors.push(`Row ${rowNum}: ${cat.code} value "${raw}" is not a number.`);
        return;
      }
      values[cat.code] = num;
    }
    validRows.push({
      team: result.data.team,
      player: result.data.player,
      position: result.data.position as Position,
      started,
      values,
    });
  });

  if (errors.length > 0) return { ok: false, imported: 0, errors };
  if (validRows.length === 0) return { ok: false, imported: 0, errors: ["CSV had no data rows."] };

  const resolved: {
    playerId: string;
    teamId: string;
    position: Position;
    started: boolean;
    values: Record<string, number>;
  }[] = [];

  for (const row of validRows) {
    const team = await prisma.team.findFirst({
      where: { name: row.team, seasonId: week.seasonId },
    });
    if (!team) {
      errors.push(`Team "${row.team}" not found in this season.`);
      continue;
    }
    const rosterEntry = await prisma.rosterEntry.findFirst({
      where: { teamId: team.id, droppedAt: null, player: { fullName: row.player } },
    });
    if (!rosterEntry) {
      errors.push(
        `Player "${row.player}" is not on ${row.team}'s active roster. Log an ADD transaction first if this is a new pickup.`
      );
      continue;
    }
    resolved.push({
      playerId: rosterEntry.playerId,
      teamId: team.id,
      position: row.position,
      started: row.started,
      values: row.values,
    });
  }

  if (errors.length > 0) return { ok: false, imported: 0, errors };

  await prisma.$transaction(async (tx) => {
    for (const row of resolved) {
      await tx.weeklyRosterSlot.upsert({
        where: { weekId_teamId_playerId: { weekId, teamId: row.teamId, playerId: row.playerId } },
        create: { weekId, teamId: row.teamId, playerId: row.playerId, slot: row.position, started: row.started },
        update: { slot: row.position, started: row.started },
      });
      for (const [code, value] of Object.entries(row.values)) {
        const category = categoryByCode.get(code)!;
        await tx.statLine.upsert({
          where: { weekId_playerId_categoryId: { weekId, playerId: row.playerId, categoryId: category.id } },
          create: { weekId, playerId: row.playerId, categoryId: category.id, value, source: "CSV_IMPORT" },
          update: { value, source: "CSV_IMPORT" },
        });
      }
    }
  });

  return { ok: true, imported: resolved.length, errors: [] };
}
