export function RatingForm({
  action,
  existingScore,
  existingComment,
}: {
  action: (formData: FormData) => void | Promise<void>;
  existingScore?: number;
  existingComment?: string | null;
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label htmlFor="score" className="text-sm font-medium text-white">
          Your rating
        </label>
        <select
          id="score"
          name="score"
          defaultValue={existingScore ?? 7}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-white [&>option]:text-ink"
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} / 10
            </option>
          ))}
        </select>
      </div>
      <textarea
        name="comment"
        rows={2}
        defaultValue={existingComment ?? ""}
        placeholder="Optional roast (or praise, if you must)"
        className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-cream/50 focus:border-red focus:outline-none"
      />
      <button
        type="submit"
        className="w-fit rounded-lg bg-red px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        {existingScore ? "Update rating" : "Submit rating"}
      </button>
    </form>
  );
}
