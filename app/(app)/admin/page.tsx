import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";

const CARDS = [
  {
    href: "/admin/matchups",
    title: "Matchup Results",
    body: "Enter this week's category-by-category matchup totals.",
  },
  {
    href: "/admin/stats",
    title: "Stat Lines",
    body: "Upload a CSV of per-player weekly stats and started/benched status.",
  },
  {
    href: "/admin/transactions/new",
    title: "Log a Transaction",
    body: "Record an add, drop, or trade so the league can rate it.",
  },
  {
    href: "/admin/recaps",
    title: "Recaps",
    body: "Generate, edit, and publish the weekly newsletter.",
  },
];

export default function AdminOverviewPage() {
  return (
    <>
      <PageHeader title="Commissioner Admin" subtitle="Weekly data entry and the recap pipeline." />
      <SectionCard title="What do you want to do?">
        <div className="grid gap-4 sm:grid-cols-2">
          {CARDS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-xl border-r-4 border-l-4 border-blue bg-cream-soft px-5 py-4 shadow-sm transition hover:shadow-md"
            >
              <h3 className="font-heading text-lg text-red">{c.title}</h3>
              <p className="mt-1 text-sm text-neutral-700">{c.body}</p>
            </Link>
          ))}
        </div>
      </SectionCard>
    </>
  );
}
