import { prisma } from "@/lib/prisma";

/** SyncProgress.key for "Sync full season game logs" — shared by the
 * trigger route, the status route, and the client polling component so
 * none of them can drift out of sync with each other. */
export const FULL_SEASON_SYNC_PROGRESS_KEY = "full-season-game-logs";

/**
 * Live progress tracking for a long-running admin sync, backed by the
 * SyncProgress table (see schema.prisma for the full rationale) rather than
 * in-memory state — this app runs on Vercel's serverless functions, which
 * don't reliably share memory across invocations/instances, so anything a
 * polling request needs to read back has to actually be persisted.
 */

export interface SyncProgressState {
  total: number;
  completed: number;
  status: "running" | "done" | "error";
  message: string | null;
}

/** Starts (or restarts) tracking for `key` — resets completed to 0 even if
 * a previous run under this key is still marked "running", since a new run
 * starting means the old one is no longer the one worth watching. */
export async function startSyncProgress(key: string, total: number): Promise<void> {
  await prisma.syncProgress.upsert({
    where: { key },
    create: { key, total, completed: 0, status: "running", message: null },
    update: { total, completed: 0, status: "running", message: null },
  });
}

/** Call once per unit of work finished (e.g. once per player processed,
 * regardless of whether that player synced, was skipped, or errored) —
 * an atomic DB increment, safe to call concurrently from parallel
 * mapWithConcurrency workers. */
export async function incrementSyncProgress(key: string): Promise<void> {
  await prisma.syncProgress.update({ where: { key }, data: { completed: { increment: 1 } } });
}

export async function finishSyncProgress(key: string, message: string): Promise<void> {
  await prisma.syncProgress.update({ where: { key }, data: { status: "done", message } });
}

export async function failSyncProgress(key: string, message: string): Promise<void> {
  await prisma.syncProgress.update({ where: { key }, data: { status: "error", message } });
}

export async function getSyncProgress(key: string): Promise<SyncProgressState | null> {
  const row = await prisma.syncProgress.findUnique({ where: { key } });
  if (!row) return null;
  return {
    total: row.total,
    completed: row.completed,
    status: row.status as SyncProgressState["status"],
    message: row.message,
  };
}
