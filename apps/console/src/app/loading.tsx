/** Скелетон серверных страниц: навигация стримится сразу, контент - по готовности. */
export default function Loading() {
  return (
    <main aria-busy="true">
      <div className="mb-6 h-8 w-64 animate-pulse rounded-lg bg-raised/60" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl border border-line bg-surface/40" />
        ))}
      </div>
    </main>
  );
}
