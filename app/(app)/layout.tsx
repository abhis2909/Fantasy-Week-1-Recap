import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { Crest } from "@/components/ui/Crest";

const NAV_LINKS = [
  { href: "/standings", label: "Standings" },
  { href: "/categories", label: "Categories" },
  { href: "/team-of-the-week", label: "Team of the Week" },
  { href: "/players", label: "Players" },
  { href: "/transactions", label: "Transactions" },
  { href: "/recaps", label: "Recaps" },
];

async function doSignOut() {
  "use server";
  await signOut({ redirectTo: "/standings" });
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Viewing the league site is public — no sign-in wall. A session is only
  // needed to submit transaction ratings and to reach /admin (both of those
  // routes/components check auth() themselves), so this layout renders the
  // same shell either way and just adapts the nav.
  const session = await auth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-2 border-gold bg-navy-deep px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <Link href="/standings" className="flex items-center gap-2 font-heading text-xl tracking-wide text-gold uppercase">
            <Crest className="h-8 w-8" />
            Slapshot City FHL
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-cream/80">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-gold">
                {link.label}
              </Link>
            ))}
            {session?.user.role === "COMMISSIONER" && (
              <Link href="/admin" className="text-gold hover:opacity-80">
                Admin
              </Link>
            )}
          </nav>
          {session ? (
            <form action={doSignOut} className="flex items-center gap-3">
              <span className="text-sm text-cream/60">{session.user.name}</span>
              <button type="submit" className="text-sm font-medium text-cream/60 hover:text-gold">
                Sign out
              </button>
            </form>
          ) : (
            <Link href="/login" className="text-sm font-medium text-cream/60 hover:text-gold">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-navy/10 bg-cream px-4 py-8 text-center text-sm text-neutral-500">
        Slapshot City Fantasy Hockey League — commissioner-run, not Yahoo-affiliated.
      </footer>
    </div>
  );
}
