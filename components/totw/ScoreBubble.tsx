export function ScoreBubble({ value }: { value: number | string }) {
  return (
    <div className="absolute -top-4 -right-3 rounded-full bg-gold px-3.5 py-3.5 text-sm font-bold text-navy-deep shadow-md shadow-gold/30">
      {value}
    </div>
  );
}
