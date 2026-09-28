import { createComponentImplementation } from "@a2ui/react/v0_9";
import { z } from "zod";
import { dynamicText } from "../../runtime/dynamicBinding";

const textApi = {
  name: "WorkflowText",
  schema: z
    .object({
      text: dynamicText,
      role: z.enum(["eyebrow", "title", "body", "step"]),
    })
    .strict(),
};

export const WorkflowText = createComponentImplementation(
  textApi,
  ({ props }) => {
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
  },
);
