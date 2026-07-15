export function MarketplacePage(): React.ReactElement {
  return (
    <section className="mx-auto max-w-[1440px] px-5 py-20 text-center sm:px-8 lg:px-16">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Proma Skill Marketplace</p>
      <h1 className="mx-auto mt-5 max-w-3xl text-balance text-5xl font-medium tracking-[-0.045em] sm:text-6xl">释放你的 Agent 潜能</h1>
      <p className="mx-auto mt-5 max-w-2xl font-serif text-lg leading-8 text-muted">浏览经过社区验证的 Skills，让 Proma 快速获得专业能力。</p>
      <div className="mx-auto mt-12 max-w-4xl rounded-xl bg-panel p-10 text-left shadow-card">
        <div className="h-12 animate-pulse rounded-lg bg-canvas" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-40 animate-pulse rounded-lg bg-canvas" />)}
        </div>
      </div>
    </section>
  )
}
