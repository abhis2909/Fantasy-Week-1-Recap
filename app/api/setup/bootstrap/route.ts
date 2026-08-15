import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedLeague } from "@/lib/seedLeague";

/**
 * One-time, token-gated bootstrap for a freshly-deployed database — for
 * seeding a deployment when there's no local terminal handy. Self-disabling:
 * refuses to run if the database already has any users, so it can't be used
 * to wipe a live league later.
 *
 * Requires two env vars to be set in the deployment (not committed):
 *   SETUP_TOKEN            — shared secret
 *   COMMISSIONER_PASSWORD  — becomes the commissioner's login password
 *
 * Two ways to trigger it, same effect either way:
 *   - Click a link: GET /api/setup/bootstrap?token=<SETUP_TOKEN>
 *   - curl:         POST with header `x-setup-token: <SETUP_TOKEN>`
 */
async function runBootstrap(token: string | null) {
  const expectedToken = process.env.SETUP_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "SETUP_TOKEN is not configured on the server." },
      { status: 500 }
    );
  }
  if (token !== expectedToken) {
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

export async function GET(request: NextRequest) {
  return runBootstrap(request.nextUrl.searchParams.get("token"));
}

export async function POST(request: NextRequest) {
  return runBootstrap(request.headers.get("x-setup-token"));
}
