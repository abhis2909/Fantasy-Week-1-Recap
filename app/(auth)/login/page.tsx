import { redirect } from "next/navigation";
import Image from "next/image";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { SectionCard } from "@/components/ui/SectionCard";
import { HighlightBox } from "@/components/ui/HighlightBox";

async function submitLogin(formData: FormData) {
  "use server";
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    redirect("/login?error=1");
  }
  try {
    await signIn("credentials", { email, password, redirectTo: "/standings" });
  } catch (err) {
    // signIn() throws a special redirect signal on success — only a real
    // auth failure should be treated as an error here.
    if (err instanceof AuthError) {
      redirect("/login?error=1");
    }
    throw err;
  }
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const session = await auth();
  if (session) redirect("/standings");
  const sp = await searchParams;
  const hasError = "error" in sp;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative flex flex-col items-center justify-center overflow-hidden border-b-[6px] border-b-blue px-5 py-16 text-center">
        <Image
          src="/images/arena-hero.jpg"
          alt=""
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-navy-ink/70" />
        <div className="relative">
          <h1 className="font-heading text-4xl tracking-wide text-white sm:text-5xl">
            🏒 Slapshot City Fantasy Hockey League
          </h1>
          <p className="mt-3 text-cream/90">
            Standings, stats, and a newsletter that will not be kind to your
            roster decisions. Browsing the site doesn&apos;t require an
            account — sign in below only if you want to rate a transaction
            or you&apos;re the commissioner.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4">
        <SectionCard title="Sign in" className="w-full">
          {hasError && (
            <HighlightBox title="Couldn't sign you in">
              Wrong email or password. Ask the commissioner if you don&apos;t
              have an account yet.
            </HighlightBox>
          )}
          <form action={submitLogin} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-white">
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                placeholder="you@example.com"
                className="rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-white placeholder-cream/50 focus:border-red focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-white">
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                className="rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-white focus:border-red focus:outline-none"
              />
            </label>
            <button
              type="submit"
              className="mt-2 rounded-lg bg-red px-5 py-2.5 font-semibold text-white transition hover:opacity-90"
            >
              Sign in
            </button>
          </form>
          <p className="mt-4 text-sm text-cream/70">
            Tip: when your browser offers to save this password, let it —
            on iPhone/Mac that means Face ID or Touch ID unlocks it for you
            next time instead of typing it again.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
