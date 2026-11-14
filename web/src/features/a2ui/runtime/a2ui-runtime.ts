import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { replaceEqualDeep } from "@tanstack/react-query";
import { workflowCatalog } from "../catalog/workflow-catalog";
import type { A2UIOutput } from "./outputs";
import type { WorkflowOutputMetadata } from "@shared/workflow-output";

export interface A2UISurfaceView {
  id: string;
  toolCallId?: string;
  surface: SurfaceModel<ReactComponentImplementation>;
  presentation?: WorkflowOutputMetadata["presentation"];
}

interface AppliedOutputState {
  surfaces: A2UISurfaceView[];
  /** Includes recovered buffered outputs and replayed inputs that were already applied. */
  appliedOutputs: A2UIOutput[];
}

export type A2UIIngestResult = AppliedOutputState &
  (
    | { kind: "ready" }
    | { kind: "waiting"; missingOutputSeq: number }
    | { kind: "failed"; error: string }
  );

/** Owns ordered output replay and SDK surface subscriptions; its caller must dispose it. */
export function createA2UIRuntime() {
  const processor = new MessageProcessor<ReactComponentImplementation>([
    workflowCatalog,
  ]);

  const outputs = new Map<number, A2UIOutput>();
  const byId = new Map<string, A2UIOutput>();
  let nextOutputSeq = 1;
  let highestOutputSeq = 0;

  let currentOutput: A2UIOutput | undefined;
  let surfaces: A2UISurfaceView[] = [];
  let failure: string | null = null;
  let disposed = false;

  const created = processor.onSurfaceCreated((surface) => {
    const presentation = currentOutput?.workflow?.presentation;

    surfaces = [
      ...surfaces,
      {
        id: `${currentOutput?.id ?? "surface"}:${surface.id}`,
        ...(currentOutput?.toolCallId
          ? { toolCallId: currentOutput.toolCallId }
          : {}),
        surface,
        ...(presentation?.surfaceId === surface.id ? { presentation } : {}),
      },
    ];
  });

  const deleted = processor.onSurfaceDeleted((id) => {
    surfaces = surfaces.filter((view) => view.surface.id !== id);
  });

  function bufferOutputs(incoming: A2UIOutput[]) {
    for (const output of incoming) {
      const existing = byId.get(output.id) ?? outputs.get(output.outputSeq);

      if (existing) {
        const conflictingReplay =
          existing.id !== output.id ||
          existing.outputSeq !== output.outputSeq ||
          existing.toolCallId !== output.toolCallId ||
          replaceEqualDeep(existing.workflow, output.workflow) !==
            existing.workflow ||
          replaceEqualDeep(existing.messages, output.messages) !==
            existing.messages;

        if (conflictingReplay) {
          failure = `Conflicting A2UI output: ${output.id}`;
        }

        continue;
      }

      byId.set(output.id, output);
      outputs.set(output.outputSeq, output);
      highestOutputSeq = Math.max(highestOutputSeq, output.outputSeq);
    }
  }

  function discardOutputSurfaces(output: A2UIOutput) {
    // The processor cannot roll back a batch. Hide every touched surface
    // rather than show a partially applied result as a completed output.
    for (const message of output.messages) {
      let surfaceId: string;

      if ("createSurface" in message) {
        surfaceId = message.createSurface.surfaceId;
      } else if ("updateComponents" in message) {
        surfaceId = message.updateComponents.surfaceId;
      } else if ("updateDataModel" in message) {
        surfaceId = message.updateDataModel.surfaceId;
      } else {
        surfaceId = message.deleteSurface.surfaceId;
      }

      processor.model.deleteSurface(surfaceId);
    }
  }

  function applyBufferedOutputs(applied: Map<number, A2UIOutput>) {
    // Database sequence order is shared by the live stream and recovery snapshots.
    // A gap waits for recovery instead of applying an update before its creation.
    while (!failure) {
      const output = outputs.get(nextOutputSeq);

      if (!output) {
        break;
      }

      currentOutput = output;

      try {
        // Data binding must not mutate the saved payload used to detect duplicates.
        processor.processMessages(structuredClone(output.messages));
        applied.set(output.outputSeq, output);
        nextOutputSeq += 1;
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Processing failed";

        failure = `Could not apply A2UI output ${output.id}: ${detail}`;
        discardOutputSurfaces(output);
      }

      currentOutput = undefined;
    }
  }

  function ingest(incoming: A2UIOutput[]): A2UIIngestResult {
    const applied = new Map<number, A2UIOutput>();

    if (!disposed) {
      bufferOutputs(incoming);
      applyBufferedOutputs(applied);
    }

    if (failure) {
      return {
        kind: "failed",
        surfaces,
        appliedOutputs: [],
        error: failure,
      };
    }

    // Snapshots replay applied outputs to restore replies missing from their message archive.
    for (const input of incoming) {
      const known = outputs.get(input.outputSeq);

      if (known && known.outputSeq < nextOutputSeq) {
        applied.set(known.outputSeq, known);
      }
    }

    const appliedOutputs = [...applied.values()];

    appliedOutputs.sort((left, right) => left.outputSeq - right.outputSeq);

    if (!disposed && highestOutputSeq >= nextOutputSeq) {
      return {
        kind: "waiting",
        surfaces,
        appliedOutputs,
        missingOutputSeq: nextOutputSeq,
      };
    }

    return {
      kind: "ready",
      surfaces,
      appliedOutputs,
    };
  }

  function dispose() {
    disposed = true;

    created.unsubscribe();
    deleted.unsubscribe();
    processor.model.dispose();

    surfaces = [];
    outputs.clear();
    byId.clear();
  }

  return { ingest, dispose };
}
