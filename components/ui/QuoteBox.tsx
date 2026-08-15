export function QuoteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-l-4 border-gold bg-white px-6 py-6 text-center text-lg italic text-neutral-800 shadow-sm">
      {children}
    </div>
  );
}
