import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  maxKnowledgeBytes,
  type KnowledgeTextEncoding,
} from "@shared/knowledge";
import { knowledgeRequest, listKnowledge } from "./api";

const queryKey = ["knowledge", "documents"];

export interface KnowledgeOperation {
  kind: "upload" | "reindex" | "delete";
  id: string;
}

interface DocumentRequest {
  path: string;
  init: RequestInit;
  operation: KnowledgeOperation;
  controller: AbortController;
}

export function useKnowledgeDocuments() {
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pending = useRef<{ id: string; file: File } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [retryUpload, setRetryUpload] = useState(false);
  const documents = useQuery({
    queryKey,
    queryFn: ({ signal }) => listKnowledge(signal),
    refetchInterval: (query) =>
      query.state.data?.some((document) =>
        ["uploading", "queued", "indexing"].includes(document.status),
      )
        ? 2000
        : false,
  });
  const mutation = useMutation({
    mutationFn: ({ path, init, controller }: DocumentRequest) =>
      knowledgeRequest(path, { ...init, signal: controller.signal }),
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

  function clearError() {
    setValidationError(null);
    mutation.reset();
  }

  async function perform(
    path: string,
    init: RequestInit,
    operation: KnowledgeOperation,
  ) {
    if (controller.current) {
      return;
    }

    const request = new AbortController();

    controller.current = request;
    setValidationError(null);

    try {
      await mutation.mutateAsync({
        path,
        init,
        operation,
        controller: request,
      });

      return !request.signal.aborted && mounted.current ? true : undefined;
    } catch {
      if (!request.signal.aborted && mounted.current) {
        return false;
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
      }
    }
  }

  async function upload() {
    const document = pending.current;

    if (!document) {
      return;
    }

    const uploaded = await perform(
      "",
      {
        method: "POST",
        body: document.file,
        headers: {
          "X-Filename": encodeURIComponent(document.file.name),
          "X-Document-Id": document.id,
        },
      },
      { kind: "upload", id: document.id },
    );

    if (uploaded && pending.current === document) {
      pending.current = null;
      setRetryUpload(false);
    } else if (uploaded === false) {
      // A lost PUT response may hide a committed upload; retry the original identity.
      setRetryUpload(true);
    }
  }

  function selectFile(file: File, resumeId: string | null) {
    if (controller.current) {
      return;
    }

    if (
      !file.size ||
      file.size > maxKnowledgeBytes ||
      !/\.(txt|md|pdf)$/i.test(file.name)
    ) {
      setValidationError(
        "Use a nonempty TXT, Markdown or PDF file up to 10 MiB",
      );

      return;
    }

    pending.current = { id: resumeId ?? crypto.randomUUID(), file };
    void upload();
  }

  function reindex(id: string, encoding?: KnowledgeTextEncoding | null) {
    const init: RequestInit = { method: "POST" };

    if (encoding !== undefined) {
      init.headers = { "X-Text-Encoding": encoding ?? "auto" };
    }

    return perform(`/${id}/reindex`, init, { kind: "reindex", id });
  }

  return {
    documents,
    operation: mutation.isPending ? mutation.variables.operation : null,
    busy: mutation.isPending,
    inFlight: () => controller.current !== null,
    error: validationError ?? (mutation.error ? mutation.error.message : null),
    clearError,
    retryUpload,
    selectFile,
    upload,
    reindex,
    remove: (id: string) =>
      perform(`/${id}`, { method: "DELETE" }, { kind: "delete", id }),
  };
}
