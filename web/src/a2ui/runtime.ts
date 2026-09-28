import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { replaceEqualDeep } from "@tanstack/react-query";
import { workflowCatalog } from "./catalog";
import type { A2UIOutput } from "./outputs";

export interface A2UISurfaceView {
  id: string;
  toolCallId?: string;
  surface: SurfaceModel<ReactComponentImplementation>;
}

export type A2UIIngestResult =
  | { kind: "ready"; surfaces: A2UISurfaceView[] }
  | { kind: "waiting"; surfaces: A2UISurfaceView[]; missingOutputSeq: number }
  | { kind: "failed"; surfaces: A2UISurfaceView[]; error: string };

export function createA2UIRuntime() {
  const processor = new MessageProcessor([workflowCatalog]);
  const outputs = new Map<number, A2UIOutput>();
  const byId = new Map<string, A2UIOutput>();
  let nextOutputSeq = 1;
  let highestOutputSeq = 0;
  let currentOutput: A2UIOutput | undefined;
  let surfaces: A2UISurfaceView[] = [];
  let failure: string | null = null;
  let disposed = false;

  const created = processor.onSurfaceCreated((surface) => {
    surfaces = [
      ...surfaces,
      {
        id: `${currentOutput?.id ?? "surface"}:${surface.id}`,
        ...(currentOutput?.toolCallId
          ? { toolCallId: currentOutput.toolCallId }
          : {}),
        surface,
      },
    ];
  });
  const deleted = processor.onSurfaceDeleted((id) => {
    surfaces = surfaces.filter((view) => view.surface.id !== id);
  });

  function ingest(incoming: A2UIOutput[]): A2UIIngestResult {
    if (!disposed) {
      for (const output of incoming) {
        const existing = byId.get(output.id) ?? outputs.get(output.outputSeq);

        if (existing) {
          if (
            existing.id !== output.id ||
            existing.outputSeq !== output.outputSeq ||
            existing.toolCallId !== output.toolCallId ||
            replaceEqualDeep(existing.messages, output.messages) !==
              existing.messages
          ) {
            failure = `Conflicting A2UI output: ${output.id}`;
          }

          continue;
        }

        byId.set(output.id, output);
        outputs.set(output.outputSeq, output);
        highestOutputSeq = Math.max(highestOutputSeq, output.outputSeq);
      }

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
          nextOutputSeq += 1;
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "Processing failed";

          failure = `Could not apply A2UI output ${output.id}: ${detail}`;

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

        currentOutput = undefined;
      }
    }

    if (failure) {
      return { kind: "failed", surfaces, error: failure };
    }

    if (!disposed && highestOutputSeq >= nextOutputSeq) {
      return { kind: "waiting", surfaces, missingOutputSeq: nextOutputSeq };
    }

    return { kind: "ready", surfaces };
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
