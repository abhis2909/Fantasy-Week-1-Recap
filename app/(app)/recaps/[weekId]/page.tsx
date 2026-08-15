import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { HighlightBox } from "@/components/ui/HighlightBox";
import { QuoteBox } from "@/components/ui/QuoteBox";
import { PlayerCard } from "@/components/totw/PlayerCard";
import { shortStatSummary } from "@/lib/statSummary";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export default async function RecapArticlePage({
  params,
}: PageProps<"/recaps/[weekId]">) {
  const { weekId } = await params;
  const session = await auth();
  const isCommissioner = session?.user.role === "COMMISSIONER";

  const article = await prisma.recapArticle.findUnique({
    where: { weekId },
    include: { sections: { orderBy: { order: "asc" } }, week: true },
  });

  if (!article) notFound();
  if (!article.isPublished && !isCommissioner) notFound();

  const totwSelections = await prisma.teamOfWeekSelection.findMany({
    where: { weekId },
    include: { player: true },
    orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
  });

  const totwStatLines = await prisma.statLine.findMany({
    where: { weekId, playerId: { in: totwSelections.map((sel) => sel.playerId) } },
    include: { category: true },
  });
  const valuesByPlayer = new Map<string, Record<string, number>>();
  for (const sl of totwStatLines) {
    const values = valuesByPlayer.get(sl.playerId) ?? {};
    values[sl.category.code] = sl.value;
    valuesByPlayer.set(sl.playerId, values);
  }

  return (
    <>
      <PageHeader
        title={article.title}
        subtitle={`Week ${article.week.number}${article.isPublished ? "" : " — DRAFT PREVIEW"}`}
      />
      <SectionCard>
        {article.sections.map((section) =>
          section.type === "QUOTE" ? (
            <div key={section.id} className="my-4">
              <QuoteBox>{section.body}</QuoteBox>
            </div>
          ) : (
            <div key={section.id}>
              <HighlightBox title={section.title}>{section.body}</HighlightBox>
              {section.type === "TOTW" && totwSelections.length > 0 && (
                <div className="my-4 flex flex-wrap justify-center gap-6 rounded-xl bg-white/5 py-6">
                  {totwSelections.map((sel) => (
                    <PlayerCard
                      key={sel.id}
                      playerId={sel.playerId}
                      name={sel.player.fullName}
                      position={sel.position}
                      photoUrl={sel.player.photoUrl}
                      rating={sel.rating}
                      statLine={shortStatSummary(sel.position, valuesByPlayer.get(sel.playerId) ?? {})}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </SectionCard>
    </>
  );
}
