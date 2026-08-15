/** Consistent display formatting for a category value, by category code. */
export function formatStatValue(value: number | undefined | null, code: string): string {
  if (value === undefined || value === null) return "–";
  if (code === "SV%") return value.toFixed(3);
  if (code === "GAA") return value.toFixed(2);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
