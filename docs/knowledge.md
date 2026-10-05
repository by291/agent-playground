# Shared knowledge

[Documentation index](README.md) · [Shared S3 configuration](development.md#s3-compatible-storage)

## Upload and file limits

Open **Knowledge** in the chat sidebar to upload TXT, Markdown or text PDFs. Documents are shared across conversations. Uploads are limited to 10 MiB; PDF extraction supports up to 200 unencrypted pages and two million extracted characters. Scanned PDFs need OCR before upload.

TXT and Markdown must be UTF-8, with or without a BOM. Index extraction does not detect or convert legacy encodings.

## Embedding configuration

Configure embeddings independently of DeepSeek in the root `.env`:

```dotenv
RAG_EMBEDDING_BASE_URL=https://your-provider.example/v1
RAG_EMBEDDING_MODEL=your-embedding-model
RAG_EMBEDDING_API_KEY=your-key
RAG_EMBEDDING_BATCH_SIZE=10
# Optional, only if your provider supports dimensions:
RAG_EMBEDDING_DIMENSIONS=
RAG_MAX_DISTANCE=0.55
```

`RAG_MAX_DISTANCE` is the largest cosine distance accepted as evidence, between 0 and 2; lower values require closer matches. The adapter sends literal text to an OpenAI-compatible `/embeddings` endpoint, avoiding OpenAI-specific token-array inputs. Batch size affects request grouping, not chunking or index identity. The code default is 10; the repository's Qwen example sets 20. Match this setting and optional `dimensions` to the actual provider/model contract.

Restart the agent after changing embedding settings. Endpoint, model and dimension changes select a different index profile; use **Reindex** for existing documents. No substitute embeddings are generated when configuration is missing or the provider fails.

## Indexing and lifecycle

Original bytes use the shared S3 client in the TypeScript server; PostgreSQL stores document/job state and pgvector chunks. Skills and knowledge share the configured bucket with separate object keys. Use [S3 configuration](development.md#s3-compatible-storage) for endpoints and credentials.

The Python HTTP application runs the durable indexing worker. It downloads originals through the authenticated internal application route, extracts text with pypdf in an owned subprocess, splits with LangChain, calls embeddings and stages pgvector chunks. Each attempt has a two-minute deadline and a three-minute lease. Expired jobs are reclaimed after restart; only the current generation can publish a ready index. Failed jobs can be retried from the page. Incomplete uploads can resume with the same original file. Reindexing immediately hides the previous chunks.

The visible states are `uploading`, `queued`, `indexing`, `ready` and `failed`. Only ready chunks for the current embedding profile are searchable. Text extraction uses an owned subprocess and LangChain splitting at 1,200 characters with 150 characters of overlap; PDF pages retain their source page number. Changing request batch size does not require reindexing.

## Answer citations and original passages

Ask the agent a question about the uploaded documents or shared knowledge base. `search_knowledge` returns up to five matching excerpts from ready documents under the current embedding profile, each with a citation Markdown link bound to its chunk ID. New answers are instructed to place that exact link after the supported sentence or paragraph. The interface renders it as a numbered footnote: clicking opens that precise excerpt, filename and PDF page in the side reader, while closing returns focus to the citation. Repeated retrievals of a chunk share its number within a reply; references absent from that reply's retrieved sources display as unavailable. Citation associations express the model's choice of evidence, without automatically verifying that the excerpt supports its claim.

The compact **Sources** button opens the same reader for all retrieved passages, including older answers without inline citations. A single document displays its filename; multiple documents use the shared document selector. Move between retrieved passages and download the original; sources and inline citations remain available after reloading a conversation. Searches with no evidence are shown explicitly.

Citations bind a sentence/paragraph to a retrieved chunk ID, not a guessed filename or numeric marker. Clicking selects the exact saved excerpt in the side reader. The reader shows retrieved text and PDF page metadata; it does not locate a word range in a full-document editor. Old answers without citation positions retain the Sources button and do not receive fabricated sentence-level attribution.

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

1. Check the document's UTF-8 encoding or extractable PDF text and the upload/extraction limits.
2. Check `RAG_EMBEDDING_BASE_URL`, model and API key in the root environment, independently of the chat model configuration.
3. For provider `BadRequestError`, check the maximum texts per request and whether that model accepts `dimensions`. Leave the optional dimension setting empty unless supported.
4. Inspect `.dev/agent.log` for the indexing error; verify server S3/internal-token settings if originals cannot be downloaded.
5. Restart the agent after configuration changes, then use **Retry indexing** or **Reindex** as appropriate. Raising the retrieval-distance threshold cannot fix an indexing failure.
