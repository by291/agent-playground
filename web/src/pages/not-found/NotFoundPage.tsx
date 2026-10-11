import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-ink">
      <title>Page Not Found · Agent Playground</title>
      <Empty className="flex-none">
        <EmptyHeader>
          <EmptyTitle>
            <h1 className="text-lg font-semibold">Page not found</h1>
          </EmptyTitle>
        </EmptyHeader>
        <Button asChild variant="link" className="h-11">
          <a href="/">Open agent chat</a>
        </Button>
      </Empty>
    </main>
  );
}
