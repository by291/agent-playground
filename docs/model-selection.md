# Conversation model selection

Web and Android select a model from the server-owned catalog at the existing model control beside Send. The picker retains context details and shows unconfigured models as disabled. Selection preserves the draft and takes effect on the next normal turn. Existing conversations save selection through the backend; a new conversation keeps its choice in the local journal until admission. The Web picker supports keyboard selection and returns focus to its trigger when closed.

## Provider configuration

Python reads the private root `models.yaml`, created from [models.example.yaml](../models.example.yaml) by `make setup`. The local file contains provider keys and is ignored by Git; the example has empty keys. The TypeScript backend fetches the public catalog from Python. Credentials and provider addresses never appear in metadata, conversation snapshots or Android journals.

Both providers use the same schema. The usual configuration only needs a provider, model name, key and optional thinking level:

```yaml
chat:
  default: deepseek
  models:
    deepseek:
      provider: deepseek
      model: deepseek-flash
      api_key: "your-deepseek-key"
      thinking: medium
    qwen:
      provider: qwen
      model: qwen3.8-flash
      api_key: "your-qwen-key"
      thinking: disabled
```

Set `chat.default: qwen` to make it the default. Stable entry names such as `deepseek` and `qwen` are persisted model IDs. Keep those IDs while changing provider model names. Supported adapters are `deepseek` and `qwen`, both using Chat Completions.

| Chat model field    | Meaning when omitted                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `model` | Required; identify the provider adapter and model information.                                                              |
| `api_key`           | Empty; the catalog entry is unavailable.                                                                                    |
| `thinking`          | `disabled`; other choices are `low`, `medium`, `high`.                                                                      |
| `label`             | Model information supplies the display label.                                                                               |
| `base_url`          | Provider endpoint: `https://api.deepseek.com` or `https://maas.qianwenaiapi.com/compatible-mode/v1`.                        |
| `max_input_tokens`  | Use the effective model input budget calculated below.                                                                      |
| `max_output_tokens` | Use the documented output default for the thinking level, or the SDK output limit when no documented default is registered. |

`chat.compact_ratio` defaults to `0.8` and is greater than `0.2` and less than `1`. `a2a_model` chooses the independent child-agent model, and `embedding` contains its separate endpoint, model, key, dimensions and quotas. See [Agent configuration](agent-configuration.md) for all file boundaries.

Restart managed development services after changes with `make dev-stop && make dev`; settings and compiled graphs are cached for the process lifetime. Configuration syntax and field errors are reported without quoting credential values. Deployment may set `MODELS_CONFIG_PATH` to another private file. The old model-related environment variables are no longer read.

### Output and thinking

`max_output_tokens` is an optional override for one response, including thinking and the final answer. It changes the requested budget, not the model's capability limit. DeepSeek sends it as native `max_tokens`; Qwen sends `max_completion_tokens` because its legacy `max_tokens` does not cap reasoning. Overrides must be positive and cannot exceed the model's known ceiling.

The application translates the same thinking levels into each provider's native effort. These levels express relative effort within a model; they do not promise equal thinking token counts across providers.

| Application level | DeepSeek native effort       | Qwen native effort           |
| ----------------- | ---------------------------- | ---------------------------- |
| `disabled`        | Thinking explicitly disabled | Thinking explicitly disabled |
| `low`             | `low`                        | `low`                        |
| `medium`          | `high`                       | `medium`                     |
| `high`            | `max`                        | `xhigh`                      |

No separate `enabled`, native `effort` or numeric `budget_tokens` field is accepted. Omitted thinking is explicitly disabled in the request, independently of provider defaults.

The normalized model information in [model_profiles.py](../agent_playground/model_profiles.py) combines bundled LangChain profiles with verified overrides. The two built-in entries were verified on October 7, 2026; runtime startup does not scrape model pages or issue model calls. Verified entries take precedence over incomplete or stale SDK profiles.

| Model            | Total context | Maximum output | Default output without thinking | Default output with thinking            |
| ---------------- | ------------: | -------------: | ------------------------------: | --------------------------------------- |
| `deepseek-flash` |     1,000,000 |        393,216 |                           8,192 | `low`/`medium`: 65,536; `high`: 131,072 |
| `qwen3.8-flash`  |     1,000,000 |        131,072 |                         131,072 | 131,072                                 |

DeepSeek's defaults and output ceiling follow its [Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/). Qwen's output limit follows its [model page](https://www.qianwenai.com/models/qwen3.8-flash); the meaning and default of `max_completion_tokens` follow its [Chat Completions reference](https://docs.qwencloud.com/api-reference/chat/openai-chat).

Summary calls disable thinking and cap output at 4,096 tokens. A2A child calls disable thinking and cap output at 2,200 tokens. These scenario caps also respect an explicit smaller output override. Structured SQL revisions disable thinking on a local model copy without changing the main conversation model, because forced function selection is incompatible with thinking.

DeepSeek uses `langchain-deepseek`; Qwen uses the `ChatQwen` integration from `langchain-qwq`, listed in the [LangChain Qwen documentation](https://docs.langchain.com/oss/python/integrations/chat/qwen). The small provider adapters restore `reasoning_content` to assistant history after library serialization so thinking tool calls can continue across synchronous and asynchronous streaming requests. DeepSeek thinking tool requests also include an empty reasoning field for historical nonthinking or workflow replies, allowing model switches to reuse existing history. This follows its [thinking tool-call contract](https://api-docs.deepseek.com/guides/thinking_mode/). Provider HTTP, streaming, usage and tool parsing remain library-owned. Function calling supplies SQL's validated revision schema.

### Input budget and compaction

`max_input_tokens` is an optional cap on input history, replacing the old `context_window_tokens` name. Request construction and compaction read the same resolved model configuration. The effective input budget is:

```text
min(input limit for the thinking level,
    optional max_input_tokens override,
    total context capacity - resolved normal-chat output budget)
```

The UI's `contextWindow` reports this effective input budget; it is not the total advertised context length. Input overrides must be positive and cannot exceed the model's maximum input limit. Enabling thinking can further lower the effective budget without requiring the configured cap to change.

For Qwen3.8-Flash, the input limits are 991,808 without thinking and 983,616 with thinking, from its [model page](https://www.qianwenai.com/models/qwen3.8-flash). Its default output budget leaves 868,928 input tokens in either mode. An explicit 32,768-token output budget leaves 967,232 input tokens. DeepSeek's `medium` default leaves 934,464 input tokens.

For other model names, the application requires complete SDK context/output metadata or a verified entry in the model information registry. LangChain's `max_input_tokens` profile field represents the total context window; the application normalizes it before reserving output. A budget override cannot supply a missing model capacity. Missing information or unsupported thinking levels fail configuration validation rather than guessing safe limits. Add verified capacities and thinking support centrally when introducing a model whose SDK metadata is incomplete.

Token estimates include reasoning replayed in assistant history and conservatively budget 16,384 tokens per Qwen image and 1,024 per DeepSeek image. Provider-reported input usage appears after a model call. The Qwen visual bound comes from its [Chat Completions reference](https://docs.qwencloud.com/api-reference/chat/openai-chat).

Catalog availability means a key is configured, not that the provider has verified the key, model permission or quota. Incorrect credentials and provider errors surface through normal run failure/recovery. Embedding selection is independent of conversation selection. A2A planner/reviewer models use `a2a_model`, which defaults to the DeepSeek catalog entry, in model mode. See [A2A configuration](a2a-demo.md).

## Selection, admission and recovery

`GET /agent-info` retains the legacy default `model` name and adds `defaultModelId` and `models`, whose entries contain only `id`, `label`, `model` and `available`. Stable IDs (`deepseek`, `qwen`) decouple the selection from provider model names. Older metadata responses remain readable by the clients.

`PATCH /conversations/:threadId/model` accepts `{ "modelId": "qwen" }` and returns `{ "threadId": "...", "modelId": "qwen" }`. It validates the catalog and locks the conversation before persisting. Missing conversations return 404. Active, unknown, paused or externally waiting conversations reject switching with 409; Web and Android apply the same guards and block selection during attachment upload. The server publishes a conversation-change notification after a successful change.

A normal AG-UI request may carry `forwardedProps.modelId`. The server validates that option, discards other client forwarding properties, and resolves the effective model while admitting the run under the conversation lock. It writes the conversation selection and a separate immutable run model before upstream creation. Only the server constructs `config.configurable.model_id` for Aegra. Omitted choices use the saved conversation selection or the server default.

Duplicate admissions keep their original model; a changed explicit selection with the same request identity conflicts. Review resumes and background external-task continuations inherit the paused run's model. Changing the default never changes a newly pinned run. Preexisting database rows without model IDs remain readable and use legacy default behavior; their original model cannot be reconstructed retrospectively.

Web and Android journal the complete pending request before dispatch, including model selection. Retrying or restoring an ambiguous request therefore retains the original model and admission IDs. A new conversation retains its local choice when an attachment upload has created an empty server row but no run has been admitted. Canonical snapshots carry the conversation selection and each run's model ID. Metadata refreshes do not replace a saved selection. Context indicators hide usage belonging to another model, and switching recomputes budgets while reusing the same LangGraph checkpoint. Compaction affects private model context; the public transcript remains recoverable.

The Web blocks admission while a selection request is pending. On failure it keeps the previous choice, shows the error in the picker and requests a canonical snapshot to reconcile any uncertain server write. Android blocks admission after a lost selection response until a fresh canonical snapshot reconciles the saved choice. The server adapter explicitly retains its trusted `model_id` configuration field when the SDK filters against the compiled graph schema, because Aegra's graph factory consumes it before graph execution.

## Verification

`make check` covers catalog secrecy/availability, provider request serialization, output reserves, thinking settings and tool-history replay, model factory selection, shared checkpoint history, SQL structured output, locked admission/selection, duplicate requests, pauses, external continuations and Web selection/journal recovery. PostgreSQL integration tests own temporary databases.

`pnpm test:e2e` covers the Web picker with the real backend and official SDK: draft preservation, keyboard focus, reload, first admission, existing-conversation changes, immutable run selection and disabled choices during a run. A controlled Aegra fixture confirms that the selected model ID reaches the upstream request even when the graph schema omits the factory's configuration field.

`make android-check` covers metadata/journal compatibility, local selection persistence, exact request retries, snapshot races, selection guards and Compose picker behavior. Controlled transport tests do not establish real provider compatibility. Real Qwen calls require `chat.models.qwen.api_key` in the private `models.yaml`; device interaction validation is separate from JVM/Robolectric checks.
