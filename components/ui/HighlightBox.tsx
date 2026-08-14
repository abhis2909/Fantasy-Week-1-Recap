/**
 * The blue-left/red-right bordered callout used for individual recap
 * beats — Tightest Matchup, Manager of the Week, Choker of the Week, etc.
 */
export function HighlightBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="my-4 rounded-xl border-r-4 border-l-4 border-blue bg-cream-soft px-5 py-4 text-ink shadow-sm">
      <h3 className="mb-1.5 font-heading text-lg tracking-wide text-red">
        {title}
      </h3>
      <div className="text-sm leading-relaxed text-neutral-800 sm:text-base">
        {children}
      </div>
    </div>
  );
}
