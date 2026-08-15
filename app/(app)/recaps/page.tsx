import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { getCurrentSeason } from "@/lib/currentSeason";
import { prisma } from "@/lib/prisma";

export default async function RecapsListPage() {
  const season = await getCurrentSeason();
  const articles = await prisma.recapArticle.findMany({
    where: { isPublished: true, week: { seasonId: season.id } },
    include: { week: true },
    orderBy: { week: { number: "desc" } },
  });

  return (
    <>
      <PageHeader title="Weekly Recaps" subtitle="The newsletter, hostile yet friendly." />
      <SectionCard title="Published Issues">
        {articles.length === 0 ? (
          <p className="text-cream/80">Nothing published yet. Check back after Week 1 wraps.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {articles.map((a) => (
              <Link
                key={a.id}
                href={`/recaps/${a.weekId}`}
                className="rounded-xl border-l-4 border-gold bg-cream-soft px-5 py-4 shadow-sm transition hover:shadow-md"
              >
                <h3 className="font-heading text-lg text-navy-deep">{a.title}</h3>
                <p className="text-xs text-neutral-500">
                  Week {a.week.number} &middot; published{" "}
                  {a.publishedAt?.toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
