import { useRef } from "react";
import { MemoryWorkspace } from "@/features/memory";
import { ManagementLayout } from "@/layouts/ManagementLayout";

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
