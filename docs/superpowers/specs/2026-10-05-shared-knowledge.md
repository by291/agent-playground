# Shared knowledge retrieval

The user requested a working shared knowledge base for documents available across conversations, using an OpenAI-compatible embedding API with configurable URL, model and key. Continue in the current checkout without a worktree. Repository instructions authorize direct implementation after key requirements are clear.

## Behavior and ownership

- One shared workspace knowledge collection. TXT, Markdown and text PDF uploads are limited to 10 MiB. No OCR or tenant model in this version.
- TypeScript owns upload/download HTTP, document metadata, retry/delete admission and S3 cleanup. Generalize the existing S3 client and configuration for both Skills and knowledge.
- Python owns extraction, splitting, embeddings, vector indexing and the search tool. Use pypdf, LangChain splitters, OpenAIEmbeddings and PGVectorStore rather than implementing their protocols.
- PostgreSQL 18 retains existing data and gains pgvector. Drizzle owns document and chunk table migrations. Vector dimensions are unconstrained in SQL; a hashed provider/model/dimensions profile separates incompatible indexes. Exact cosine search avoids an unproven ANN/index policy.
- Upload commits an intent before object creation; same ID/content can recover a failed upload. State progresses uploading → queued → indexing → ready/failed. A deleted timestamp immediately hides files and vectors. Retry/reindex hides old vectors and creates a fresh indexing generation.
- A Python worker claims queued or expired jobs with row locks, a generation token and a three-minute lease. Extraction, embedding and staging are bounded to two minutes. Only the current generation can atomically publish chunks and ready state; failed, deleted or replaced attempts never become searchable. Restart reclaims expired jobs. Publication uses a cancellable async transaction; extraction uses an owned subprocess terminated on cancellation. Shutdown cancels and closes owned clients.
- Source bytes remain S3 objects; document rows survive conversation deletion. Deleted S3 objects and chunks are removed by a retryable TypeScript worker, with per-document transactions and persistent fair attempt ordering. A metadata tombstone prevents delayed upload retries from reusing deleted document IDs. Paginated S3 object reconciliation requeues late remote PUT completions for cleanup.
- Agent search is an ordinary tool, with bounded query/results and current-profile/visible filtering. It returns structured source IDs, names, pages, excerpts and distance. The UI shows retrieved sources from actual tool results, independently of collapsed tool details and after reload. The prompt treats document content as data and requires supported answers or an honest no-evidence response.
- A Knowledge page provides upload, state, retry/reindex, original download and deletion. It is linked from chat navigation without violating feature imports. Shared contracts own source/document types.

## Validation

Use isolated PostgreSQL with pgvector and S3 containers. Cover malformed/oversized input, upload recovery, ownership independent of chat, delete/reindex visibility, stale generation publication, restart recovery, embedding failure, no matches and empty/scanned PDF. Validate actual vector ranking with controlled embeddings; test configured real embeddings separately when credentials are available. Browser regression covers upload/state/download/delete and restored source links. Run full project checks and one independent implementation review. Real-model/provider results are reported separately.
