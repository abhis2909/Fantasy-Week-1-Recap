"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Position } from "@/lib/generated/prisma/client";

export interface PlayerSearchEntry {
  id: string;
  fullName: string;
  primaryPosition: Position;
  teamName: string;
  avatarUrl: string;
}

const MAX_RESULTS = 8;

/**
 * Type-ahead search over the roster (small enough — a couple hundred
 * players at most — to filter entirely client-side, no API round trip).
 * Selecting a result jumps straight to that player's page.
 */
export function PlayerSearchBar({ players }: { players: PlayerSearchEntry[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return players
      .filter(
        (p) => p.fullName.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q)
      )
      .slice(0, MAX_RESULTS);
  }, [query, players]);

  function goTo(id: string) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(`/players/${id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      goTo(results[highlighted].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative mx-auto mb-6 max-w-md">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search players by name or team…"
        className="w-full rounded-lg border border-gold/40 bg-white/10 px-4 py-2.5 text-white placeholder-cream/50 outline-none focus:border-gold"
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={handleKeyDown}
      />
      {open && query.trim() !== "" && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gold/40 bg-navy-deep shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-cream/60">No players match &quot;{query}&quot;.</p>
          ) : (
            results.map((p, i) => (
              <button
                key={p.id}
                type="button"
                // onMouseDown (not onClick) fires before the input's onBlur closes the dropdown.
                onMouseDown={() => goTo(p.id)}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
                  i === highlighted ? "bg-gold/20" : "hover:bg-white/5"
                }`}
              >
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-white">
                  <Image src={p.avatarUrl} alt="" fill className="object-cover" sizes="36px" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{p.fullName}</p>
                  <p className="truncate text-xs tracking-wide text-cream/60 uppercase">
                    {p.primaryPosition} · {p.teamName}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
