import { redirect } from "next/navigation";
import Image from "next/image";
import { auth, signIn } from "@/lib/auth";
import { SectionCard } from "@/components/ui/SectionCard";

async function requestMagicLink(formData: FormData) {
  "use server";
  const email = formData.get("email");
  if (typeof email !== "string" || !email) return;
  await signIn("resend", { email, redirectTo: "/standings" });
}

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/standings");

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
            roster decisions.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4">
        <SectionCard title="Sign in" className="w-full">
          <form action={requestMagicLink} className="flex flex-col gap-4 sm:flex-row">
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="flex-1 rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-white placeholder-cream/50 focus:border-red focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-red px-5 py-2.5 font-semibold text-white transition hover:opacity-90"
            >
              Send magic link
            </button>
          </form>
          <p className="mt-4 text-sm text-cream/70">
            Only emails the commissioner has added as a manager can sign in.
            Ask them if yours isn&apos;t working.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
