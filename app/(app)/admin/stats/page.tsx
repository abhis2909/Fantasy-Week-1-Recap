import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { HighlightBox } from "@/components/ui/HighlightBox";
import { getCurrentSeason } from "@/lib/currentSeason";
import { prisma } from "@/lib/prisma";
import { importStatLinesCsv } from "@/lib/csv/parseStatLines";

export default async function AdminStatsPage({
  searchParams,
}: PageProps<"/admin/stats">) {
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const weeks = await prisma.week.findMany({
    where: { seasonId: season.id },
    orderBy: { number: "desc" },
  });
  const selectedWeekId =
    (Array.isArray(sp.week) ? sp.week[0] : sp.week) || weeks[0]?.id;
  const categories = await prisma.scoringCategory.findMany({
    where: { leagueId: season.leagueId, enabled: true },
    orderBy: { sortOrder: "asc" },
  });
  const errors = (Array.isArray(sp.errors) ? sp.errors : sp.errors ? [sp.errors] : []) as string[];
  const imported = Array.isArray(sp.imported) ? sp.imported[0] : sp.imported;

  const needsCategoryUpdate =
    !categories.some((c) => c.code === "SHP") ||
    (await prisma.scoringCategory.findFirst({
      where: { leagueId: season.leagueId, code: "+/-", enabled: true },
    })) !== null;
  const categoriesUpdated = sp.categoriesUpdated === "1";

  async function updateScoringCategories() {
    "use server";
    const skaterPositions = ["C", "LW", "RW", "D"] as const;
    // Same slot the old Plus/Minus category held, so the new column lands
    // in roughly the same place instead of at the end of the list.
    await prisma.scoringCategory.upsert({
      where: { leagueId_code: { leagueId: season.leagueId, code: "SHP" } },
      create: {
        leagueId: season.leagueId,
        code: "SHP",
        label: "Shorthanded Points",
        appliesTo: [...skaterPositions],
        higherIsBetter: true,
        sortOrder: 3,
      },
      update: { enabled: true },
    });
    await prisma.scoringCategory.updateMany({
      where: { leagueId: season.leagueId, code: "+/-" },
      data: { enabled: false },
    });
    revalidatePath("/admin/stats");
    revalidatePath("/standings");
    revalidatePath("/categories");
    redirect("/admin/stats?categoriesUpdated=1");
  }

  async function uploadCsv(formData: FormData) {
    "use server";
    const weekId = formData.get("weekId") as string;
    const file = formData.get("csv") as File | null;
    if (!weekId || !file || file.size === 0) {
      redirect(`/admin/stats?week=${weekId}&errors=${encodeURIComponent("Pick a week and choose a CSV file.")}`);
    }
    const text = await file!.text();
    const result = await importStatLinesCsv(weekId, text);
    revalidatePath("/admin/stats");
    if (!result.ok) {
      const qs = result.errors.map((e) => `errors=${encodeURIComponent(e)}`).join("&");
      redirect(`/admin/stats?week=${weekId}&${qs}`);
    }
    redirect(`/admin/stats?week=${weekId}&imported=${result.imported}`);
  }

  return (
    <>
      <PageHeader title="Stat Lines" subtitle="Upload a week's per-player stats via CSV." />

      {(needsCategoryUpdate || categoriesUpdated) && (
        <SectionCard title="Update scoring categories">
          {categoriesUpdated ? (
            <HighlightBox title="Categories updated">
              Shorthanded Points is now a live category; Plus/Minus is retired (its history is
              kept, just no longer shown or scored going forward).
            </HighlightBox>
          ) : (
            <>
              <p className="text-cream/80">
                This league&apos;s actual category set is Goals, Assists, Power Play Points,
                Shorthanded Points, Shots on Goal, Penalty Minutes, Hits, and Blocks for
                skaters — Wins, GAA, SV%, and Shutouts for goalies. The categories currently
                configured still include Plus/Minus and are missing Shorthanded Points. This
                adds Shorthanded Points and retires Plus/Minus (its historical data stays in
                the database, it just stops counting toward standings and stops being
                displayed going forward). Existing weeks aren&apos;t retroactively
                recomputed — only the current league configuration changes.
              </p>
              <form action={updateScoringCategories}>
                <button
                  type="submit"
                  className="mt-3 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
                >
                  Add Shorthanded Points, retire Plus/Minus
                </button>
              </form>
            </>
          )}
        </SectionCard>
      )}

      <SectionCard title="Expected format">
        <p className="text-sm text-cream/80">
          Columns: <code className="text-white">team, player, position, started</code>, plus
          one column per scoring category code for this league:
        </p>
        <p className="mt-2 font-mono text-sm text-white">
          {categories.map((c) => c.code).join(", ")}
        </p>
        <p className="mt-2 text-sm text-cream/80">
          <code className="text-white">team</code> and <code className="text-white">player</code>{" "}
          must exactly match an existing team name and a player already on that team&apos;s
          active roster (log an ADD transaction first for new pickups).{" "}
          <code className="text-white">started</code> is true/false. Category columns only
          need values relevant to that player&apos;s position — leave others blank.
        </p>
      </SectionCard>

      <SectionCard title="Upload">
        {imported && (
          <HighlightBox title="Success">
            Imported stat lines for {imported} player{imported === "1" ? "" : "s"}.
          </HighlightBox>
        )}
        {errors.length > 0 && (
          <HighlightBox title="Import failed — nothing was saved">
            <ul className="list-disc pl-5">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </HighlightBox>
        )}
        <form action={uploadCsv} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-white">
            Week
            <select
              name="weekId"
              defaultValue={selectedWeekId}
              className="w-fit rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white [&>option]:text-ink"
            >
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  Week {w.number}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-white">
            CSV file
            <input
              type="file"
              name="csv"
              accept=".csv,text/csv"
              required
              className="w-fit rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white file:mr-3 file:rounded file:border-0 file:bg-gold file:px-3 file:py-1 file:text-navy-deep"
            />
          </label>
          <button
            type="submit"
            className="w-fit rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
          >
            Import
          </button>
        </form>
      </SectionCard>
    </>
  );
}
