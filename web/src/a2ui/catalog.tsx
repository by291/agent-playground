import { Fragment } from "react";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { Catalog, ComponentIdSchema } from "@a2ui/web_core/v0_9";
import { z } from "zod";

export const workflowCatalogId = "urn:agent-playground:workflow:v1";

const panelApi = {
  name: "WorkflowPanel",
  schema: z.object({ children: z.array(ComponentIdSchema) }).strict(),
};

const textApi = {
  name: "WorkflowText",
  schema: z
    .object({
      text: z.string(),
      role: z.enum(["eyebrow", "title", "body", "step"]),
    })
    .strict(),
};

const stepsApi = {
  name: "WorkflowSteps",
  schema: z.object({ children: z.array(ComponentIdSchema) }).strict(),
};

const WorkflowPanel = createComponentImplementation(
  panelApi,
  ({ props, buildChild }) => (
    <section className="rounded-2xl border border-accent-line bg-accent-soft/40 p-5 shadow-sm">
      <div className="flex flex-col gap-3">
        {props.children.map((child) => (
          <Fragment key={typeof child === "string" ? child : child.id}>
            {typeof child === "string"
              ? buildChild(child)
              : buildChild(child.id, child.basePath)}
          </Fragment>
        ))}
      </div>
    </section>
  ),
);

const WorkflowText = createComponentImplementation(textApi, ({ props }) => {
  if (props.role === "eyebrow") {
    return (
      <p className="text-[11px] font-semibold tracking-[0.14em] text-accent uppercase">
        {props.text}
      </p>
    );
  }
  if (props.role === "title") {
    return (
      <h3 className="text-base font-semibold tracking-[-0.02em] text-ink">
        {props.text}
      </h3>
    );
  }
  if (props.role === "step") {
    return <span>{props.text}</span>;
  }
  return <p className="text-sm/6 text-muted">{props.text}</p>;
});

const WorkflowSteps = createComponentImplementation(
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

export const workflowCatalog = new Catalog(workflowCatalogId, [
  WorkflowPanel,
  WorkflowText,
  WorkflowSteps,
]);

export const workflowComponentNames = [...workflowCatalog.components.keys()];
