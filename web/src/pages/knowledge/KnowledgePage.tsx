import { KnowledgeWorkspace } from "@/features/knowledge";
import { ManagementLayout } from "@/layouts/ManagementLayout";

/** Mounts shared document management within the application shell. */
export function KnowledgePage() {
  return (
    <ManagementLayout>
      <KnowledgeWorkspace />
    </ManagementLayout>
  );
}
