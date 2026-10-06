# Shared knowledge

[Documentation index](README.md) · [Shared S3 configuration](development.md#s3-compatible-storage)

## Upload and file limits

Open **Knowledge** in the chat sidebar to upload TXT, Markdown or text PDFs. Documents are shared across conversations. Uploads are limited to 10 MiB; PDF extraction supports up to 200 unencrypted pages and two million extracted characters. Scanned PDFs need OCR before upload.

TXT and Markdown default to automatic encoding detection. Unicode BOMs determine UTF-8, UTF-16 or UTF-32; unsigned files first use strict UTF-8, then charset-normalizer considers GB18030, GBK, Big5, Windows-1252, Shift JIS and UTF-16/32 byte orders. Detection is restricted to these codecs. Short legacy text with little language evidence and competing decodings without clear language evidence are rejected with an actionable indexing error instead of silently producing garbage.

Use **Text encoding** in a document's **…** actions menu on Web or Android to choose an encoding and reindex, including returning to **Automatic detection**. Web keeps **Download** beside the menu; reindexing and deletion are in the menu. The choice is stored with the shared document and survives reload, indexing retries and worker restarts. Regular **Reindex** and **Retry indexing** preserve it. PDFs do not expose this control. Decoding is strict, rejects non-text control characters, and never uses replacement characters or an unconditional Latin-1 fallback. Automatic detection remains a heuristic; an explicit encoding is useful when a valid-looking detection produces the wrong text.

The original stored bytes and download remain unchanged. API uploads and reindex requests may specify `X-Text-Encoding` with one of `utf-8`, `utf-16-le`, `utf-16-be`, `utf-32-le`, `utf-32-be`, `gb18030`, `gbk`, `big5`, `cp1252`, or `shift_jis`; `auto` selects automatic detection. Omission on reindex or upload resume preserves the existing choice. Encoding changes use the same indexing generation fencing as other reindex requests.

## Embedding configuration

Configure embeddings independently of DeepSeek in the root `.env`:

```dotenv
RAG_EMBEDDING_BASE_URL=https://your-provider.example/v1
RAG_EMBEDDING_MODEL=your-embedding-model
RAG_EMBEDDING_API_KEY=your-key
RAG_EMBEDDING_BATCH_SIZE=10
RAG_EMBEDDING_TPM=1000000
RAG_EMBEDDING_RPM=24000
RAG_EMBEDDING_MAX_RETRIES=5
RAG_INDEX_TIMEOUT_SECONDS=600
# Optional: use the same account scope across endpoint aliases.
RAG_EMBEDDING_QUOTA_SCOPE=
# Optional, only if your provider supports dimensions:
RAG_EMBEDDING_DIMENSIONS=
RAG_MAX_DISTANCE=0.55
```

`RAG_MAX_DISTANCE` is the largest cosine distance accepted as evidence, between 0 and 2; lower values require closer matches. The OpenAI SDK sends literal text to an OpenAI-compatible `/embeddings` endpoint, with float vectors. Batch size affects request grouping, not chunking or index identity. The code default is 10; the repository's Qwen example sets 20. Match this setting and optional `dimensions` to the actual provider/model contract.

### Shared quotas and batch recovery

Indexing and search share weighted request/token limits through the existing `REDIS_URL`. The maintained `limits` library uses Redis sliding-window counters, with second and minute budgets and 20% headroom. All application instances sharing an account/model must use the same Redis database and quota settings. Limits default to Qwen 3.7 embedding flash's published 1,000,000 TPM and 24,000 RPM; configure lower values when your provider or business space has a smaller quota. These are application budgets, not a measurement of all other applications using that provider account.

Quota identity groups the endpoint and model across API keys and embedding dimensions. Set the same `RAG_EMBEDDING_QUOTA_SCOPE` across endpoint aliases to group them under one account; different models retain separate budgets. Quota settings and scope do not change index identity. Redis unavailability stops requests rather than bypassing admission.

Each batch fits both the maximum text count and the estimated second-level token budget. Every document starts with UTF-8 bytes plus eight units per text. After three successful batches with usable provider usage, reservations use an EWMA of the actual-to-byte-estimate ratio (weight 0.3), guarded by the highest ratio in the last twelve samples and 25% estimation headroom. Recent higher usage raises the next reservation immediately; older high samples eventually expire. Batches below 256 baseline units do not train the estimator, and each text reserves at least eight units. These are predictions, not an exact model tokenizer or a statistical guarantee against rate limits.

Calibration belongs to one document attempt. A different document starts fresh, and search queries always use the conservative estimate. Missing, zero or invalid usage clears calibration and restores conservative reservations until three usable samples are available again. A 429 disables calibration for the rest of that attempt. If reverting makes the pending batch too large, it is split into conservative batches with the remaining retry allowance; completed earlier batches are retained. An individual fragment larger than the active budget is rejected before sending with an actionable error; shorten it or check the quota configuration. Redis counters keep the estimate reserved at dispatch; usage calibrates later requests rather than refunding earlier reservations.

HTTP 429 responses establish a shared cooldown. `Retry-After` seconds, HTTP dates and `retry-after-ms` are honored; absent valid hints, retries use exponential backoff with jitter. The SDK's internal retry loop is disabled so each attempt passes shared admission and generation checks. Transient connection failures and HTTP 408/409/5xx also retry the current batch. `RAG_EMBEDDING_MAX_RETRIES` defaults to five retries after the initial attempt and may be zero. Successful earlier batches stay in memory while that batch recovers. If the attempt ultimately fails or the process restarts, a new indexing attempt still recomputes the document; there is no persistent embedding cache or cross-attempt checkpoint.

Restart the agent after changing embedding settings. Endpoint, model and dimension changes select a different index profile; use **Reindex** for existing documents. No substitute embeddings are generated when configuration is missing or the provider fails.

## Indexing and lifecycle

Original bytes use the shared S3 client in the TypeScript server; PostgreSQL stores document/job state and pgvector chunks. Skills and knowledge share the configured bucket with separate object keys. Use [S3 configuration](development.md#s3-compatible-storage) for endpoints and credentials.

The Python HTTP application runs the durable indexing worker. It downloads originals through the authenticated internal application route, extracts text with pypdf in an owned subprocess, splits with LangChain, calls embeddings and stages pgvector chunks. `RAG_INDEX_TIMEOUT_SECONDS` bounds the whole attempt, including quota waits and retries, and defaults to ten minutes. Its three-minute lease is renewed during batch waits and every thirty seconds throughout downloading, extraction and persistence. Each dispatch rechecks ownership; deleted, expired or replaced generations stop sending new requests. A request already in flight may finish before cancellation is observed. Expired jobs are reclaimed after restart; only the current generation can publish a ready index. Failed jobs can be retried from the page. Incomplete uploads can resume with the same original file. Reindexing immediately hides the previous chunks.

The visible states are `uploading`, `queued`, `indexing`, `ready` and `failed`. Only ready chunks for the current embedding profile are searchable. Text extraction uses an owned subprocess and LangChain splitting at 1,200 characters with 150 characters of overlap; PDF pages retain their source page number. Changing request batch size does not require reindexing.

## Answer citations and original passages

Ask the agent a question about the uploaded documents or shared knowledge base. `search_knowledge` returns up to five matching excerpts from ready documents under the current embedding profile, each with a citation Markdown link bound to its chunk ID. New answers are instructed to place that exact link after the supported sentence or paragraph. Web and Android render it as a numbered footnote. Clicking opens that precise excerpt, filename and PDF page: Web uses its side reader, while Android opens a partial bottom sheet that expands to full height when dragged upward. Android keeps document selection, passage navigation and the original download above the excerpt so they remain accessible while partially expanded. System Back collapses the expanded sheet first, then dismisses it; drag downward or use Close to return to the answer. Repeated retrievals of a chunk share its number within a reply; references absent from that reply's retrieved sources display as unavailable. Citation associations express the model's choice of evidence, without automatically verifying that the excerpt supports its claim.

The compact **Sources** button opens the same reader for all retrieved passages, including older answers without inline citations. A single document displays its filename; multiple documents use the shared document selector. Move between retrieved passages and download the original; sources and inline citations remain available after reloading a conversation. Searches with no evidence are shown explicitly.

Citations bind a sentence/paragraph to a retrieved chunk ID, not a guessed filename or numeric marker. Clicking selects the exact saved excerpt in the source reader. The reader shows retrieved text and PDF page metadata; it does not locate a word range in a full-document editor. Old answers without citation positions retain the Sources button and do not receive fabricated sentence-level attribution.

## Deletion and cleanup

**Delete** opens a confirmation naming the shared document. Cancellation sends no deletion request. While deletion is pending, dismissal is blocked; request errors stay in the dialog and allow an explicit retry. Upload and reindex feedback identify the operation and affected document separately.

Deleting a document immediately hides its index and download. The server independently retries S3 cleanup and removes chunks. It also scans one `knowledge/` object-list page per cleanup pass to remove uploads that finish remotely after a client timeout; S3 credentials need list, get, put and delete permissions for these objects. A small metadata tombstone prevents delayed upload retries from recreating deleted document IDs. Conversation deletion does not delete shared documents; previously saved conversation excerpts remain part of that conversation's history.

## API and limits

| Endpoint                                    | Action                                           |
| ------------------------------------------- | ------------------------------------------------ |
| `GET /api/knowledge/documents`              | List shared document metadata.                   |
| `POST /api/knowledge/documents`             | Upload an original document and queue indexing.  |
| `POST /api/knowledge/documents/:id/reindex` | Hide the old index and enqueue a new generation. |
| `DELETE /api/knowledge/documents/:id`       | Revoke visibility/download and schedule cleanup. |
| `GET /api/knowledge/documents/:id/file`     | Download the original.                           |

Retrieval uses exact cosine search with up to five matches, without an approximate-nearest-neighbor index. There is no OCR, tenant permission system or document version catalog. Controlled tests cover S3, the Python worker, pgvector, restored sources and inline citation navigation; they do not establish a live model's choice of supporting evidence.

## Troubleshooting

1. For TXT or Markdown, use **Text encoding** to resolve ambiguous detection or choose the original encoding. For PDFs, check that text is extractable. Check the upload/extraction limits in either case.
2. Check `RAG_EMBEDDING_BASE_URL`, model and API key in the root environment, independently of the chat model configuration.
3. For provider `BadRequestError`, check the maximum texts per request and whether that model accepts `dimensions`. Leave the optional dimension setting empty unless supported.
4. Inspect `.dev/agent.log` for the indexing error; verify server S3/internal-token settings if originals cannot be downloaded.
5. For HTTP 429, compare `RAG_EMBEDDING_TPM`/`RPM` with your actual account or business-space limits, including their per-second equivalents. `Allocated quota exceeded` on Qwen indicates a token rate limit. Check Redis connectivity and other clients consuming the same provider quota. Wait for the cooldown before retrying.
6. Batch logs include operation, batch index, text count, estimated and actual tokens, the reservation ratio and calibration sample count used for that request, quota wait, latency, retry count, request ID and remaining-token headers when supplied. Inspect both estimate error and 429 frequency when evaluating throughput. Failed documents show a quota-specific hint or a deadline hint. Logs do not include document/query text or credentials.
7. Restart the agent after configuration changes, then use **Retry indexing** or **Reindex** as appropriate. Raising the retrieval-distance threshold cannot fix an indexing failure.
