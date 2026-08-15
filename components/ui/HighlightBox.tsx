/**
 * The gold-left-bordered callout used for individual recap beats —
 * Tightest Matchup, Manager of the Week, Choker of the Week, etc.
 */
export function HighlightBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="my-4 rounded-xl border-l-4 border-gold bg-cream-soft px-5 py-4 text-ink shadow-sm">
      <h3 className="mb-1.5 font-heading text-lg tracking-wide text-navy-deep uppercase">
        {title}
      </h3>
      <div className="text-sm leading-relaxed text-neutral-800 sm:text-base">
        {children}
      </div>
    </div>
  );
}
