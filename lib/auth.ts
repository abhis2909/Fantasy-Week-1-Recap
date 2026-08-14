import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

// In local dev without a RESEND_API_KEY, sign-in links are printed to the
// server console instead of actually emailed — the app is fully usable
// without setting up a Resend account first.
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM || "Fantasy League <league@example.com>";

const emailProvider = Resend({
  apiKey: resendApiKey || "dev-mode-unused",
  from: emailFrom,
  ...(!resendApiKey && {
    async sendVerificationRequest({
      identifier,
      url,
    }: {
      identifier: string;
      url: string;
    }) {
      console.log(
        `\n🔐 [dev] Fantasy League sign-in link for ${identifier}:\n${url}\n`
      );
    },
  }),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // @auth/prisma-adapter's published types target the default `@prisma/client`
  // output; our schema generates a custom client (see prisma/schema.prisma)
  // with an identical runtime shape, so this is a type-only mismatch, not a
  // real one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  providers: [emailProvider],
  session: { strategy: "database" },
  pages: { signIn: "/login", verifyRequest: "/login/check-email" },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user as typeof user & { role: "COMMISSIONER" | "MEMBER" }).role;
      }
      return session;
    },
  },
});
