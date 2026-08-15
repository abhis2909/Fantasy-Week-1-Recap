export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="border-b-2 border-gold bg-navy-deep px-5 py-10 text-center">
      <h1 className="animate-hero-title font-heading text-3xl tracking-wide text-gold uppercase sm:text-4xl">
        {title}
      </h1>
      {subtitle && (
        <p className="animate-hero-subtitle mt-2 text-cream/70">{subtitle}</p>
      )}
    </header>
  );
}
