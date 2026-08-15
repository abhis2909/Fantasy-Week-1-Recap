import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { getCurrentSeason } from "@/lib/currentSeason";
import { prisma } from "@/lib/prisma";

export default async function AdminRecapsPage() {
  const season = await getCurrentSeason();
  const weeks = await prisma.week.findMany({
    where: { seasonId: season.id },
    orderBy: { number: "desc" },
    include: { recapArticle: true },
  });

  return (
    <>
      <PageHeader title="Recaps" subtitle="Generate, edit, and publish each week's newsletter." />
      <SectionCard title="Weeks">
        <div className="flex flex-col gap-3">
          {weeks.map((w) => (
            <Link
              key={w.id}
              href={`/admin/recaps/${w.id}/edit`}
              className="flex items-center justify-between rounded-xl border-l-4 border-gold bg-cream-soft px-5 py-4 shadow-sm transition hover:shadow-md"
            >
              <span className="font-heading text-lg text-navy-deep">Week {w.number}</span>
              <span className="text-sm text-neutral-600">
                {!w.recapArticle
                  ? "No draft yet"
                  : w.recapArticle.isPublished
                    ? "Published"
                    : "Draft — not published"}
              </span>
            </Link>
          ))}
        </div>
      </SectionCard>
    </>
  );
}
