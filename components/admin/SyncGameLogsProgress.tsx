"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Matches lib/syncProgress.ts's SyncProgressState — duplicated rather than
 * imported since that file pulls in Prisma (server-only) and this is a
 * client component. */
interface ProgressState {
  total: number;
  completed: number;
  status: "running" | "done" | "error" | "not_started";
  message: string | null;
}

const POLL_MS = 1200;

/**
 * Replaces a plain "click and wait with zero feedback" server-action button
 * for "Sync full season game logs" — a real progress bar backed by
 * SyncProgress (lib/syncProgress.ts), polled while the sync runs in the
 * background via /api/admin/sync-game-logs (POST to start) and
 * /api/admin/sync-progress (GET to poll). A plain server-action fallback
 * button still exists below this one for when JS/fetch is somehow
 * unavailable — same "boring but always works" reasoning as
 * /api/admin/cleanup-fictional-names elsewhere on this page.
 */
export function SyncGameLogsProgress({ progressKey }: { progressKey: string }) {
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function poll() {
    const res = await fetch(`/api/admin/sync-progress?key=${encodeURIComponent(progressKey)}`);
    if (!res.ok) return;
    const data: ProgressState = await res.json();
    setProgress(data);
    if (data.status === "done" || data.status === "error") {
      stopPolling();
      router.refresh();
    }
  }

  async function start() {
    setStarting(true);
    try {
      const res = await fetch("/api/admin/sync-game-logs", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setProgress({ total: 0, completed: 0, status: "error", message: body.error ?? "Failed to start." });
        return;
      }
      await poll();
      pollRef.current = setInterval(poll, POLL_MS);
    } finally {
      setStarting(false);
    }
  }

  // Stop polling if the component unmounts mid-sync (navigating away).
  useEffect(() => () => stopPolling(), []);

  const running = progress?.status === "running";
  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={starting || running}
        className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? "Syncing…" : "Sync full season game logs"}
      </button>

      {progress && (progress.status === "running" || progress.status === "done" || progress.status === "error") && (
        <div className="mt-3 max-w-md">
          {running && (
            <>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gold transition-all duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-cream/60">
                {progress.completed} of {progress.total} players — {pct}%
              </p>
            </>
          )}
          {progress.status === "done" && (
            <p className="text-sm text-gold">Sync complete — {progress.message}</p>
          )}
          {progress.status === "error" && (
            <p className="text-sm text-danger">Sync failed — {progress.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
