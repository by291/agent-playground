import { createComponentImplementation } from "@a2ui/react/v0_9";
import { ComponentIdSchema } from "@a2ui/web_core/v0_9";
import { z } from "zod";

const stepsApi = {
  name: "WorkflowSteps",
  schema: z.object({ children: z.array(ComponentIdSchema) }).strict(),
};

export const WorkflowSteps = createComponentImplementation(
  stepsApi,
  ({ props, buildChild }) => (
    <ol className="list-decimal space-y-1 pl-5 text-sm/6 text-muted">
      {props.children.map((child) => (
        <li key={typeof child === "string" ? child : child.id}>
          {typeof child === "string"
            ? buildChild(child)
            : buildChild(child.id, child.basePath)}
        </li>
      ))}
    </ol>
  ),
);
