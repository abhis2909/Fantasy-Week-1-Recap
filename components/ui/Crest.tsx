/**
 * A small crown-and-shield crest mark, inline SVG so it renders crisp at
 * any size with no image asset. Referenced from the "Royal Hockey" concept
 * video the commissioner supplied — gold on navy, shield + crown silhouette.
 */
export function Crest({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path
        d="M24 6 L40 12 V22 C40 32 33 40 24 43 C15 40 8 32 8 22 V12 Z"
        fill="var(--color-navy)"
        stroke="var(--color-gold)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M15 19 L18 24 L24 15 L30 24 L33 19 L33 27 L15 27 Z"
        fill="var(--color-gold)"
      />
      <circle cx="15" cy="17.5" r="1.6" fill="var(--color-gold)" />
      <circle cx="24" cy="13.5" r="1.6" fill="var(--color-gold)" />
      <circle cx="33" cy="17.5" r="1.6" fill="var(--color-gold)" />
      <path
        d="M17 31 H31"
        stroke="var(--color-gold)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
