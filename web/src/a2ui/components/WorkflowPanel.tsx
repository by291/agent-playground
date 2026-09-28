import { Fragment } from "react";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { ComponentIdSchema } from "@a2ui/web_core/v0_9";
import { z } from "zod";

const panelApi = {
  name: "WorkflowPanel",
  schema: z.object({ children: z.array(ComponentIdSchema) }).strict(),
};

export const WorkflowPanel = createComponentImplementation(
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
