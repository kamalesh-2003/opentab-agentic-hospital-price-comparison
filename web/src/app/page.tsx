export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-teal-700 dark:text-teal-400">OpenTab</h1>
        <p className="mt-2 text-lg">Know the bill before you get the bill.</p>
      </div>
      <p className="text-base opacity-80">
        Ask what a procedure costs at Bay Area hospitals and compare the prices they legally publish:
        your plan&apos;s negotiated rate, the cash price, and a link to the source file for every number.
      </p>
      <p className="rounded-lg border border-teal-700/30 p-3 text-sm">Coming soon. Live comparisons are on the way.</p>
      <footer className="text-xs opacity-60">
        Prices are published estimates, not a quote. OpenTab stores no personal health information.
      </footer>
    </main>
  );
}
