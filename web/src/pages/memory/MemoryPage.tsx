import { useRef } from "react";
import { MemoryWorkspace } from "@/features/memory";
import { ManagementLayout } from "@/layouts/ManagementLayout";

/** Uses the chat link as a focus fallback when a forgotten memory row disappears. */
export function MemoryPage() {
  const backLink = useRef<HTMLAnchorElement>(null);

  return (
    <ManagementLayout backLinkRef={backLink}>
      <MemoryWorkspace
        onActionFocusFallback={() => backLink.current?.focus()}
      />
    </ManagementLayout>
  );
}
