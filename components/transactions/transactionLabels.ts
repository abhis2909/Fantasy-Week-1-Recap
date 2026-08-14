import type { TransactionDirection, TransactionType } from "@/lib/generated/prisma/client";

export const TYPE_LABELS: Record<TransactionType, string> = {
  ADD: "Waiver Add",
  DROP: "Drop",
  TRADE: "Trade",
};

export const DIRECTION_LABELS: Record<TransactionDirection, string> = {
  ADDED: "Added",
  DROPPED: "Dropped",
  TRADED_AWAY: "Traded away",
  TRADED_FOR: "Acquired",
};
