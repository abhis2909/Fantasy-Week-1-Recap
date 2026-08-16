"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ChunkResponse {
  done: boolean;
  total: number;
  completed: number;
  nextOffset: number;
  matched: number;
  upserted: number;
  skipped: string[];
  errored: string[];
}

type UiState =
  | { status: "idle" }
  | { status: "running"; total: number; completed: number }
  | {
      status: "done" | "error";
      total: number;
      completed: number;
      matched: number;
      upserted: number;
      skipped: string[];
      errored: string[];
      failureMessage?: string;
    };

/**
 * Drives "Sync full season game logs" as a client-side loop of small
 * chunked requests (POST /api/admin/sync-game-logs, one batch of players
 * per call) instead of a single request that either blocks with zero
 * feedback (the original server action) or hands the work to a background
 * job that isn't guaranteed to survive an unknown duration budget (the
 * first version of this component, found in production to just get stuck
 * partway through — see the API route's doc comment for the full
 * reasoning). Each fetch here is fast and self-contained, so progress is
 * exactly as current as the last completed chunk, and there's no
 * background state to silently die and leave the bar stuck.
 */
export function SyncGameLogsProgress() {
  const router = useRouter();
  const [state, setState] = useState<UiState>({ status: "idle" });

  async function start() {
    let offset = 0;
    let total = 0;
    let completed = 0;
    let matched = 0;
    let upserted = 0;
    const skipped: string[] = [];
    const errored: string[] = [];

    setState({ status: "running", total: 0, completed: 0 });

    try {
      for (;;) {
        const res = await fetch("/api/admin/sync-game-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const chunk: ChunkResponse = await res.json();
        total = chunk.total;
        completed = chunk.completed;
        matched += chunk.matched;
        upserted += chunk.upserted;
        skipped.push(...chunk.skipped);
        errored.push(...chunk.errored);
        setState({ status: "running", total: chunk.total, completed: chunk.completed });

        if (chunk.done) {
          setState({ status: "done", total, completed, matched, upserted, skipped, errored });
          router.refresh();
          return;
        }
        if (chunk.total === 0) break; // empty roster — nothing to do
        offset = chunk.nextOffset;
      }
    } catch (err) {
      setState({
        status: "error",
        total,
        completed,
        matched,
        upserted,
        skipped,
        errored,
        failureMessage: err instanceof Error ? err.message : "Sync failed for an unknown reason.",
      });
    }
  }

  const running = state.status === "running";
  const pct = running && state.total > 0 ? Math.round((state.completed / state.total) * 100) : 0;

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={running}
        className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy-deep transition hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? "Syncing…" : "Sync full season game logs"}
      </button>

      {state.status !== "idle" && (
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
                {state.completed} of {state.total} players — {pct}%
              </p>
            </>
          )}
          {state.status === "done" && (
            <p className="text-sm text-gold">
              Sync complete — {state.matched} player{state.matched === 1 ? "" : "s"} synced,{" "}
              {state.upserted} game{state.upserted === 1 ? "" : "s"} upserted
              {state.skipped.length > 0 ? `, ${state.skipped.length} skipped` : ""}
              {state.errored.length > 0 ? `, ${state.errored.length} errored` : ""}.
              {state.skipped.length > 0 && (
                <span className="mt-1 block text-cream/70">No exact match: {state.skipped.join(", ")}</span>
              )}
              {state.errored.length > 0 && (
                <span className="mt-1 block text-danger">Errors: {state.errored.join(", ")}</span>
              )}
            </p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-danger">
              Sync stopped after {state.completed} of {state.total} players — {state.failureMessage}. Safe to
              click the button again — it starts over from the top, but re-syncing an already-synced player
              just upserts the same data, nothing breaks.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
