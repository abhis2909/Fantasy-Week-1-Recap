import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";

const NAV_LINKS = [
  { href: "/standings", label: "Standings" },
  { href: "/categories", label: "Categories" },
  { href: "/team-of-the-week", label: "Team of the Week" },
  { href: "/transactions", label: "Transactions" },
  { href: "/recaps", label: "Recaps" },
];

async function doSignOut() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-[6px] border-b-red bg-white px-4 py-4 text-navy-ink">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <Link href="/standings" className="font-heading text-xl tracking-wide text-navy-deep">
            🏒 Slapshot City FHL
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-red">
                {link.label}
              </Link>
            ))}
            {session.user.role === "COMMISSIONER" && (
              <Link href="/admin" className="text-red hover:opacity-80">
                Admin
              </Link>
            )}
          </nav>
          <form action={doSignOut} className="flex items-center gap-3">
            <span className="text-sm text-neutral-500">{session.user.name}</span>
            <button type="submit" className="text-sm font-medium text-neutral-500 hover:text-red">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="px-4 py-8 text-center text-sm text-neutral-500">
        Slapshot City Fantasy Hockey League — commissioner-run, not Yahoo-affiliated.
      </footer>
    </div>
  );
}
