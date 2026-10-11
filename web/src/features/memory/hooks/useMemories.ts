import { useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type { Memory, MemoryPage } from "@shared/memory";
import {
  correctMemory,
  forgetMemory,
  listMemories,
  MemoryRequestError,
} from "../api/memories";

const queryKey = ["memory", "records"];

type MemoryOperation = "correct" | "forget";

interface MemoryRequest {
  kind: MemoryOperation;
  memory: Memory;
  text: string;
  controller: AbortController;
}

export function useMemories() {
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listMemories(pageParam, signal),
    getNextPageParam: (page) => page.nextOffset,
  });
  const mutation = useMutation({
    mutationFn: async (request: MemoryRequest) => {
      const { kind, memory, text, controller } = request;

      if (kind === "correct") {
        return correctMemory(memory, text, controller.signal);
      }

      await forgetMemory(memory, controller.signal);

      return null;
    },
    onSuccess: (updated, request) => {
      if (!mounted.current || request.controller.signal.aborted) {
        return;
      }

      // Keep the committed result visible even if the following refresh fails.
      client.setQueryData<InfiniteData<MemoryPage>>(queryKey, (data) => {
        if (!data) {
          return data;
        }

        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.flatMap((memory) => {
              if (memory.id !== request.memory.id) {
                return [memory];
              }

              return updated ? [updated] : [];
            }),
          })),
        };
      });
    },
    onSettled: async (_data, _error, request) => {
      if (mounted.current && !request.controller.signal.aborted) {
        await client.invalidateQueries({ queryKey });
      }
    },
  });

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  async function perform(kind: MemoryOperation, memory: Memory, text = "") {
    if (controller.current) {
      return;
    }

    const request = new AbortController();

    controller.current = request;

    try {
      await mutation.mutateAsync({ kind, memory, text, controller: request });

      return mounted.current && !request.signal.aborted ? true : undefined;
    } catch {
      if (mounted.current && !request.signal.aborted) {
        return false;
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
      }
    }
  }

  const records = new Map(
    query.data?.pages.flatMap((page) =>
      page.items.map((memory) => [memory.id, memory] as const),
    ),
  );
  const conflict =
    mutation.error instanceof MemoryRequestError &&
    mutation.error.status === 409;

  return {
    query,
    memories: Array.from(records.values()),
    busy: mutation.isPending,
    inFlight: () => controller.current !== null,
    error: mutation.error?.message ?? null,
    conflict,
    clearError: mutation.reset,
    correct: (memory: Memory, text: string) => perform("correct", memory, text),
    forget: (memory: Memory) => perform("forget", memory),
  };
}
