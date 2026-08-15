import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/nhl-sync", label: "NHL Sync" },
  { href: "/admin/matchups", label: "Matchup Results" },
  { href: "/admin/stats", label: "Stat Lines" },
  { href: "/admin/transactions/new", label: "Log Transaction" },
  { href: "/admin/recaps", label: "Recaps" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "COMMISSIONER") redirect("/standings");

  return (
    <div>
      <div className="border-b border-navy/10 bg-cream-soft px-4 py-3">
        <nav className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-neutral-600">
          {ADMIN_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-navy-deep hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
