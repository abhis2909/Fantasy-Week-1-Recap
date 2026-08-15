import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { HighlightBox } from "@/components/ui/HighlightBox";
import { getCurrentSeason } from "@/lib/currentSeason";
import { prisma } from "@/lib/prisma";
import { computeAndSaveMatchup } from "@/lib/matchups";

export default async function AdminMatchupsPage({
  searchParams,
}: PageProps<"/admin/matchups">) {
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const weeks = await prisma.week.findMany({
    where: { seasonId: season.id },
    orderBy: { number: "desc" },
  });
  const latestWeek = weeks[0];
  const selectedWeekId = (Array.isArray(sp.week) ? sp.week[0] : sp.week) || latestWeek?.id;
  const week = weeks.find((w) => w.id === selectedWeekId) ?? latestWeek;

  const teams = await prisma.team.findMany({
    where: { seasonId: season.id },
    orderBy: { name: "asc" },
  });
  const existingMatchups = week
    ? await prisma.matchup.findMany({
        where: { weekId: week.id },
        include: { homeTeam: true, awayTeam: true },
      })
    : [];

  async function startNextWeek() {
    "use server";
    const last = await prisma.week.findFirst({
      where: { seasonId: season.id },
      orderBy: { number: "desc" },
    });
    const startDate = last ? new Date(last.endDate.getTime() + 24 * 3600 * 1000) : new Date();
    const endDate = new Date(startDate.getTime() + 6 * 24 * 3600 * 1000);
    const newWeek = await prisma.week.create({
      data: {
        seasonId: season.id,
        number: (last?.number ?? 0) + 1,
        startDate,
        endDate,
      },
    });
    revalidatePath("/admin/matchups");
    redirect(`/admin/matchups?week=${newWeek.id}`);
  }

  async function computeMatchups(formData: FormData) {
    "use server";
    const weekId = formData.get("weekId") as string;
    const pairCount = Number(formData.get("pairCount"));
    let computed = 0;
    for (let i = 0; i < pairCount; i++) {
      const home = formData.get(`home-${i}`) as string;
      const away = formData.get(`away-${i}`) as string;
      if (!home || !away || home === away) continue;
      await computeAndSaveMatchup(weekId, home, away);
      computed++;
    }
    revalidatePath("/admin/matchups");
    redirect(`/admin/matchups?week=${weekId}&computed=${computed}`);
  }

  const pairRows = Math.ceil(teams.length / 2);
  const computedMsg = Array.isArray(sp.computed) ? sp.computed[0] : sp.computed;

  return (
    <>
      <PageHeader
        title="Matchup Results"
        subtitle="Pair teams up for the week; results are computed from each team's started-player stat totals."
      />

      <SectionCard title="Weeks">
        <div className="flex flex-wrap items-center gap-3">
          {weeks.map((w) => (
            <a
              key={w.id}
              href={`/admin/matchups?week=${w.id}`}
              className={`rounded-lg px-3 py-1.5 text-sm ${w.id === week?.id ? "bg-gold text-navy-deep" : "bg-white/10 text-cream/80 hover:bg-white/20"}`}
            >
              Week {w.number}
            </a>
          ))}
          <form action={startNextWeek}>
            <button
              type="submit"
              className="rounded-lg border-2 border-gold px-3 py-1.5 text-sm font-semibold text-gold transition hover:bg-gold/10"
            >
              + Start next week
            </button>
          </form>
        </div>
      </SectionCard>

      {week && (
        <SectionCard title={`Week ${week.number} matchups`}>
          {computedMsg && (
            <HighlightBox title="Done">Computed {computedMsg} matchup(s).</HighlightBox>
          )}
          <p className="mb-3 text-sm text-cream/70">
            Make sure this week&apos;s stat lines are imported first (Stat Lines page) —
            matchup results are computed from started players&apos; stat totals, not typed
            in by hand.
          </p>
          <form action={computeMatchups} className="flex flex-col gap-3">
            <input type="hidden" name="weekId" value={week.id} />
            <input type="hidden" name="pairCount" value={pairRows} />
            {Array.from({ length: pairRows }, (_, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  name={`home-${i}`}
                  defaultValue={teams[i * 2]?.id ?? ""}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-white [&>option]:text-ink"
                >
                  <option value="">— team —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <span className="text-cream/60">vs</span>
                <select
                  name={`away-${i}`}
                  defaultValue={teams[i * 2 + 1]?.id ?? ""}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-white [&>option]:text-ink"
                >
                  <option value="">— team —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button
              type="submit"
              className="w-fit rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright"
            >
              Compute matchup results
            </button>
          </form>

          {existingMatchups.length > 0 && (
            <div className="mt-6 flex flex-col gap-2">
              <h3 className="font-heading text-lg text-white">Already computed</h3>
              {existingMatchups.map((m) => (
                <div key={m.id} className="rounded-lg bg-white/5 px-4 py-2 text-sm text-white">
                  {m.homeTeam.name} {m.homeCategoryWins}–{m.awayCategoryWins} {m.awayTeam.name}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </>
  );
}
