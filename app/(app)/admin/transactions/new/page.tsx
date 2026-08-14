import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { HighlightBox } from "@/components/ui/HighlightBox";
import { getCurrentSeason, getCurrentWeek } from "@/lib/currentSeason";
import { prisma } from "@/lib/prisma";
import { TransactionDirection } from "@/lib/generated/prisma/client";

const POSITIONS = ["C", "LW", "RW", "D", "G"] as const;

export default async function NewTransactionPage({
  searchParams,
}: PageProps<"/admin/transactions/new">) {
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const season = await getCurrentSeason();
  const week = await getCurrentWeek(season.id);
  const weeks = await prisma.week.findMany({ where: { seasonId: season.id }, orderBy: { number: "desc" } });
  const teams = await prisma.team.findMany({ where: { seasonId: season.id }, orderBy: { name: "asc" } });
  const activeRoster = await prisma.rosterEntry.findMany({
    where: { droppedAt: null, team: { seasonId: season.id } },
    include: { player: true, team: true },
    orderBy: { player: { fullName: "asc" } },
  });

  async function submit(formData: FormData) {
    "use server";
    const type = formData.get("type") as "ADD" | "DROP" | "TRADE";
    const weekId = formData.get("weekId") as string;
    const initiatingTeamId = formData.get("initiatingTeamId") as string;

    if (type === "ADD") {
      const name = (formData.get("newPlayerName") as string)?.trim();
      const position = formData.get("newPlayerPosition") as (typeof POSITIONS)[number];
      if (!name || !position) {
        redirect(`/admin/transactions/new?error=${encodeURIComponent("New player name and position are required for an add.")}`);
      }
      const player = await prisma.player.create({ data: { fullName: name, primaryPosition: position } });
      await prisma.rosterEntry.create({ data: { teamId: initiatingTeamId, playerId: player.id } });
      await prisma.transaction.create({
        data: {
          weekId,
          type: "ADD",
          initiatingTeamId,
          playersInvolved: { create: [{ playerId: player.id, direction: TransactionDirection.ADDED }] },
        },
      });
    } else if (type === "DROP") {
      const rosterEntryId = formData.get("dropRosterEntryId") as string;
      const entry = await prisma.rosterEntry.findUnique({ where: { id: rosterEntryId } });
      if (!entry || entry.teamId !== initiatingTeamId) {
        redirect(`/admin/transactions/new?error=${encodeURIComponent("Selected player is not on the initiating team's active roster.")}`);
      }
      await prisma.rosterEntry.update({ where: { id: rosterEntryId }, data: { droppedAt: new Date() } });
      await prisma.transaction.create({
        data: {
          weekId,
          type: "DROP",
          initiatingTeamId,
          playersInvolved: { create: [{ playerId: entry!.playerId, direction: TransactionDirection.DROPPED }] },
        },
      });
    } else if (type === "TRADE") {
      const counterpartyTeamId = formData.get("counterpartyTeamId") as string;
      const myEntryId = formData.get("tradeMyRosterEntryId") as string;
      const theirEntryId = formData.get("tradeTheirRosterEntryId") as string;
      const myEntry = await prisma.rosterEntry.findUnique({ where: { id: myEntryId } });
      const theirEntry = await prisma.rosterEntry.findUnique({ where: { id: theirEntryId } });
      if (!counterpartyTeamId || counterpartyTeamId === initiatingTeamId) {
        redirect(`/admin/transactions/new?error=${encodeURIComponent("Pick a different counterparty team for the trade.")}`);
      }
      if (!myEntry || myEntry.teamId !== initiatingTeamId) {
        redirect(`/admin/transactions/new?error=${encodeURIComponent("The player you're trading away must be on the initiating team.")}`);
      }
      if (!theirEntry || theirEntry.teamId !== counterpartyTeamId) {
        redirect(`/admin/transactions/new?error=${encodeURIComponent("The player you're receiving must be on the counterparty team.")}`);
      }
      const now = new Date();
      await prisma.rosterEntry.update({ where: { id: myEntryId }, data: { droppedAt: now } });
      await prisma.rosterEntry.update({ where: { id: theirEntryId }, data: { droppedAt: now } });
      await prisma.rosterEntry.create({ data: { teamId: counterpartyTeamId, playerId: myEntry!.playerId } });
      await prisma.rosterEntry.create({ data: { teamId: initiatingTeamId, playerId: theirEntry!.playerId } });
      await prisma.transaction.create({
        data: {
          weekId,
          type: "TRADE",
          initiatingTeamId,
          counterpartyTeamId,
          playersInvolved: {
            create: [
              { playerId: myEntry!.playerId, direction: TransactionDirection.TRADED_AWAY },
              { playerId: theirEntry!.playerId, direction: TransactionDirection.TRADED_FOR },
            ],
          },
        },
      });
    }

    revalidatePath("/transactions");
    redirect("/transactions");
  }

  return (
    <>
      <PageHeader title="Log a Transaction" subtitle="Adds, drops, and trades — logged so the league can rate them." />
      <SectionCard title="New Transaction">
        {error && <HighlightBox title="Couldn't save that">{error}</HighlightBox>}
        <form action={submit} className="mt-2 flex flex-col gap-5 text-white">
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select name="type" defaultValue="ADD" className="w-fit rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
              <option value="ADD">Add (waiver/free agent)</option>
              <option value="DROP">Drop</option>
              <option value="TRADE">Trade</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Week
            <select name="weekId" defaultValue={week.id} className="w-fit rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>Week {w.number}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Initiating team
            <select name="initiatingTeamId" className="w-fit rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>

          <fieldset className="rounded-lg border border-white/10 p-4">
            <legend className="px-1 text-xs tracking-wide text-cream/60 uppercase">For Add</legend>
            <div className="flex flex-wrap gap-3">
              <input
                name="newPlayerName"
                placeholder="Player name"
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 placeholder-cream/50"
              />
              <select name="newPlayerPosition" defaultValue="C" className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-white/10 p-4">
            <legend className="px-1 text-xs tracking-wide text-cream/60 uppercase">For Drop</legend>
            <select name="dropRosterEntryId" className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
              <option value="">— pick player to drop —</option>
              {activeRoster.map((r) => (
                <option key={r.id} value={r.id}>{r.player.fullName} — {r.team.name}</option>
              ))}
            </select>
          </fieldset>

          <fieldset className="rounded-lg border border-white/10 p-4">
            <legend className="px-1 text-xs tracking-wide text-cream/60 uppercase">For Trade</legend>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Counterparty team
                <select name="counterpartyTeamId" className="w-fit rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
                  <option value="">— team —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <select name="tradeMyRosterEntryId" className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
                <option value="">— player leaving initiating team —</option>
                {activeRoster.map((r) => (
                  <option key={r.id} value={r.id}>{r.player.fullName} — {r.team.name}</option>
                ))}
              </select>
              <select name="tradeTheirRosterEntryId" className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 [&>option]:text-ink">
                <option value="">— player leaving counterparty team —</option>
                {activeRoster.map((r) => (
                  <option key={r.id} value={r.id}>{r.player.fullName} — {r.team.name}</option>
                ))}
              </select>
            </div>
          </fieldset>

          <button type="submit" className="w-fit rounded-lg bg-red px-5 py-2.5 font-semibold text-white transition hover:opacity-90">
            Log transaction
          </button>
        </form>
      </SectionCard>
    </>
  );
}
