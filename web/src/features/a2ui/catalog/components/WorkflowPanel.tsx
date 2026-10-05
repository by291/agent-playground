import { Fragment } from "react";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { ComponentIdSchema } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";

const panelApi = {
  name: "WorkflowPanel",
  schema: z.object({ children: z.array(ComponentIdSchema) }).strict(),
};

export const WorkflowPanel = createComponentImplementation(
  panelApi,
  ({ props, buildChild }) => (
    <section className="motion-item-enter">
      <Card className="gap-0 p-5">
        <CardContent className="flex flex-col gap-3 p-0">
          {props.children.map((child) => (
            <Fragment key={typeof child === "string" ? child : child.id}>
              {typeof child === "string"
                ? buildChild(child)
                : buildChild(child.id, child.basePath)}
            </Fragment>
          ))}
        </CardContent>
      </Card>
    </section>
  ),
);
