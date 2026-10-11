import { Catalog } from "@a2ui/web_core/v0_9";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { WorkflowText } from "./components/WorkflowText";
import { WorkflowSteps } from "./components/WorkflowSteps";
import { WorkflowSql } from "./components/WorkflowSql";

export const workflowCatalogId = "urn:agent-playground:workflow:v1";

export const workflowCatalog = new Catalog(workflowCatalogId, "v0.9", [
  WorkflowPanel,
  WorkflowText,
  WorkflowSteps,
  WorkflowSql,
]);

export const workflowComponentNames = [...workflowCatalog.components.keys()];
