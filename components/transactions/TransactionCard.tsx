import Link from "next/link";
import { TYPE_LABELS, DIRECTION_LABELS } from "./transactionLabels";
import type {
  Transaction,
  TransactionPlayer,
  Player,
  Team,
  Week,
} from "@/lib/generated/prisma/client";

type TransactionWithRelations = Transaction & {
  week: Week;
  initiatingTeam: Team;
  counterpartyTeam: Team | null;
  playersInvolved: (TransactionPlayer & { player: Player })[];
  avgRating: number | null;
  ratingCount: number;
};

export function TransactionCard({ tx }: { tx: TransactionWithRelations }) {
  return (
    <Link
      href={`/transactions/${tx.id}`}
      className="block rounded-xl border-r-4 border-l-4 border-blue bg-cream-soft px-5 py-4 shadow-sm transition hover:shadow-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="rounded-full bg-navy px-2.5 py-0.5 text-xs font-semibold tracking-wide text-white uppercase">
            {TYPE_LABELS[tx.type]}
          </span>
          <span className="ml-2 text-xs text-neutral-500">
            Week {tx.week.number} &middot; {tx.initiatingTeam.name}
            {tx.counterpartyTeam ? ` ↔ ${tx.counterpartyTeam.name}` : ""}
          </span>
        </div>
        <div className="text-right">
          {tx.ratingCount > 0 ? (
            <span className="font-heading text-lg text-red">
              {tx.avgRating}/10{" "}
              <span className="text-xs font-normal text-neutral-500">
                ({tx.ratingCount} rating{tx.ratingCount === 1 ? "" : "s"})
              </span>
            </span>
          ) : (
            <span className="text-xs text-neutral-500">No ratings yet</span>
          )}
        </div>
      </div>
      <ul className="mt-2 text-sm text-neutral-800">
        {tx.playersInvolved.map((tp) => (
          <li key={tp.id}>
            {DIRECTION_LABELS[tp.direction]}: {tp.player.fullName} ({tp.player.primaryPosition})
          </li>
        ))}
      </ul>
    </Link>
  );
}
