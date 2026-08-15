import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedLeague } from "@/lib/seedLeague";

/**
 * One-time, token-gated HTTP alternative to `npx prisma db seed` — for
 * bootstrapping a freshly-deployed database when there's no local terminal
 * handy. Self-disabling: refuses to run if the database already has any
 * users, so it can't be used to wipe a live league later.
 *
 * Requires two env vars to be set in the deployment (not committed):
 *   SETUP_TOKEN         — shared secret, sent back as the `token` header
 *   COMMISSIONER_PASSWORD — becomes the commissioner's login password
 *
 * Usage: POST with header `x-setup-token: <SETUP_TOKEN>`, empty body.
 */
export async function POST(request: NextRequest) {
  const expectedToken = process.env.SETUP_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "SETUP_TOKEN is not configured on the server." },
      { status: 500 }
    );
  }
  const providedToken = request.headers.get("x-setup-token");
  if (providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.COMMISSIONER_PASSWORD) {
    return NextResponse.json(
      { error: "COMMISSIONER_PASSWORD is not configured on the server." },
      { status: 400 }
    );
  }

  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    return NextResponse.json(
      { error: "Database already has users — refusing to overwrite existing data." },
      { status: 409 }
    );
  }

  const result = await seedLeague(prisma);
  return NextResponse.json({
    ok: true,
    commissionerEmail: result.commissionerEmail,
    teamCount: result.teamCount,
    message: "Seeded successfully. Sign in with the email above and the COMMISSIONER_PASSWORD you set.",
  });
}
