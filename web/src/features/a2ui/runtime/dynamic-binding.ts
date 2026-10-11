import {
  CommonSchemas,
  DataBindingSchema,
  DataModel,
  FunctionCallSchema,
} from "@a2ui/web_core/v0_9";

// Check the official path rules during schema validation. The SDK's reactive
// update callbacks can swallow a binding error and leave stale text on screen.
export const dynamicText = CommonSchemas.DynamicString.refine((value) => {
  try {
    validateBindingPaths(value);

    return true;
  } catch {
    return false;
  }
}, "Invalid A2UI data binding path").describe(
  CommonSchemas.DynamicString.description!,
);

function validateBindingPaths(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      validateBindingPaths(item);
    }
  } else if ("path" in value) {
    new DataModel().get(DataBindingSchema.parse(value).path);
  } else if ("call" in value) {
    const call = FunctionCallSchema.parse(value);

    for (const argument of Object.values(call.args ?? {})) {
      validateBindingPaths(argument);
    }
  }
  // Ordinary objects remain static, as they do in the official DataContext.
}
