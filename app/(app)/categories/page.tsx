import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { CategoryBreakdownTable } from "@/components/standings/CategoryBreakdownTable";
import { getCurrentSeason } from "@/lib/currentSeason";
import { computeCategoryTotals } from "@/lib/standings";

export default async function CategoriesPage() {
  const season = await getCurrentSeason();
  const data = await computeCategoryTotals(season.id);

  return (
    <>
      <PageHeader
        title="Category Breakdown"
        subtitle="Season-to-date totals, category by category."
      />
      <SectionCard title="Team Totals by Category">
        <CategoryBreakdownTable data={data} />
      </SectionCard>
    </>
  );
}
