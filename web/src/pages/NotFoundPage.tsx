export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-ink">
      <title>Page Not Found · Agent Playground</title>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <a
        href="/"
        className="rounded-lg px-3 py-2 text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Open agent chat
      </a>
    </main>
  );
}
