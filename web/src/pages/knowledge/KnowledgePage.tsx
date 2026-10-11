import { KnowledgeWorkspace } from "@/features/knowledge";
import { ManagementLayout } from "@/layouts/ManagementLayout";

export function KnowledgePage() {
  return (
    <ManagementLayout>
      <KnowledgeWorkspace />
    </ManagementLayout>
  );
}
