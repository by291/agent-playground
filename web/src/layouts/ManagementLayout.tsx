import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import type { ReactNode, Ref } from "react";

export function ManagementLayout({
  children,
  backLinkRef,
}: {
  children: ReactNode;
  backLinkRef?: Ref<HTMLAnchorElement>;
}) {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink sm:px-8">
      <div className="motion-content-enter mx-auto max-w-4xl">
        <a
          ref={backLinkRef}
          href="/"
          className="inline-flex items-center gap-2 rounded text-sm text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeftIcon size={16} aria-hidden="true" /> Back to chat
        </a>
        {children}
      </div>
    </main>
  );
}
