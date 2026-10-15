# Agent configuration

Agent configuration lives in two private YAML files. `make setup` creates them from the checked-in examples, preserves existing files, and shares the workflow callback token with the TypeScript server.

| File          | Configuration                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `models.yaml` | Chat catalog, default model, provider keys/addresses, context budgets, independent A2A model and embedding settings.     |
| `agent.yaml`  | HTTP listener, databases, Redis, workflow callbacks, demo services, A2A mode/addresses, tool approvals, Skill sandbox and observability. |
| `server/.env` | TypeScript server configuration and storage credentials.                                                                 |
| `web/.env`    | Web development configuration.                                                                                           |

The Python Agent reads its two YAML files through `agent_playground/config/agent.py` and `config/models.py`, with common validation and sanitized errors in `config/reader.py`; these readers do not load dotenv files. Inherited setting variables such as `PORT` or `DATABASE_URL` do not override YAML. Both local YAML files are ignored by Git and created with owner-only permissions on Unix. [models.example.yaml](../models.example.yaml) shows a minimal chat catalog and independent embedding settings; [agent.example.yaml](../agent.example.yaml) groups runtime settings. Provider keys are empty in both examples. Keep the local files private; the examples are suitable for version control.

## Models and keys

In `models.yaml`, fill the `api_key` inside the model entry that you want to use. Select the default with `chat.default`; existing conversation selections and pinned runs remain independent of that default. For Qwen, the fields are:

```yaml
chat:
  default: qwen
  models:
    qwen:
      provider: qwen
      model: qwen3.8-flash
      api_key: "your-provider-key"
      thinking: disabled
```

Edit this entry in the complete file rather than replacing the whole file with the fragment. Preserve the other model entries, including the entry selected by `a2a_model`. The public catalog contains only ID, label, provider model name and availability; keys and addresses stay inside Python. Availability means a nonempty key is configured, not that provider permissions or quota have been checked.

Both providers use identical chat fields. Only `provider` and `model` are required; an empty `api_key` marks the entry unavailable. `thinking` uses `disabled`, `low`, `medium` or `high`, with `disabled` as the default. Optional `label` and `base_url` use model/provider defaults. Optional `max_output_tokens` overrides the whole response budget, including reasoning; `max_input_tokens` caps history. Model capacities and default output budgets come from normalized model information, shared by request construction and context calculation. See [model selection](model-selection.md#output-and-thinking) for native effort mapping, budget defaults and internal-call limits.

`embedding` has its own key and provider settings. Its quota, retry and indexing fields are grouped with the model so they can be adjusted together. See [model selection](model-selection.md) and [knowledge](knowledge.md) for behavior and input/index limits.

## Runtime sections

`agent.yaml` groups settings by the component that consumes them:

- `http`: Agent host and port.
- `database`: Separate Aegra checkpoint/store and application database URLs.
- `redis`: Execution broker toggle and Redis URL shared with embedding admission.
- `workflow`: TypeScript callback address and internal API token.
- `services`: SQL/report demonstration service addresses.
- `a2a`: Independent child-agent mode and service addresses.
- `approvals`: Tool execution approval policy and explicit per-tool choices.
- `skills`: Published bundle directory, sandbox address/key/image, timeout, allowed hosts and explicit script environment values.
- `observability`: Trace targets, collectors, service name, metrics and exporter credentials.

The callback token at `workflow.api_token` must match `WORKFLOW_API_TOKEN` in `server/.env`. Setup fills a blank value from the existing other side, or generates one token when both are blank. Conflicting values fail without rewriting either file.

Skill scripts receive only the explicit `skills.script_environment` mapping. Put a script-only credential there when needed; it is not automatically shared with all model calls or tools.

### Tool approval policy

The main agent uses LangChain's native human-in-the-loop middleware to pause before protected tool execution. An approval authorizes the displayed operation once; it does not grant session permissions or allow tool edits. A rejection returns an error tool result without running the operation. The checkpoint retains the pending calls across reconnects and process restarts.

The effective tool policy and review descriptions are saved privately before each model call. A paused review keeps that policy when the graph is recreated, so a configuration change cannot apply the user's decision to another operation or silently remove its approval gate. Updated policy applies at the next model call after the pending batch settles.

```yaml
approvals:
  mode: side_effects
  tools:
    run_skill_script: true
```

- `side_effects` is the default. Skill scripts and memory writes/deletions require approval. Built-in queries and business workflow wrappers use their existing behavior; workflows retain their own review flows. Discovered MCP tools require approval unless their `readOnlyHint` is explicitly `true`; `destructiveHint: true` always takes priority over that annotation. Explicit `tools` booleans override this mode, including workflow wrappers.
- `all` requires approval for every exposed runtime tool. Per-tool exemptions do not bypass this mode.
- `configured` gates only tools explicitly set to `true` in `tools`.

`ask_user` clarification and `write_todos` plan bookkeeping are exceptions in every mode. Clarification always waits for an answer or rejection; plan bookkeeping executes without an approval gate. A clarification contains one to three uniquely identified questions. Optional two-to-four suggested choices never restrict free-text answers. Answer payloads must contain a nonblank answer of at most 4,000 characters for each requested ID in the original order. Invalid questions return normal tool-validation errors, and invalid native answer payloads fail before execution can continue.

## Startup and deployment

After editing either YAML file, restart the applications:

```sh
make dev-stop
make dev
```

The Agent launcher translates validated YAML settings into the environment required by Aegra, then calls its native `serve` command. Aegra owns process startup and platform-specific event loops. Its CLI may load a `.env` beside `aegra.json`, but preserves the YAML values already exported into the environment. Application settings continue to come from YAML.

Infrastructure commands call native `docker compose` directly and use Compose's standard configuration independently of Agent startup. They do not parse either Agent YAML file. With a custom sandbox credential, set Compose's `SKILL_SANDBOX_API_KEY` and the matching client value at `skills.sandbox_api_key` in `agent.yaml`. The default local credential already matches. `make infra-down` works when Agent configuration is missing or invalid.

For deployment, `AGENT_CONFIG_PATH` and `MODELS_CONFIG_PATH` may select private YAML files outside the checkout. Configure all Agent settings in those files; old runtime and model environment variables are ignored. Tests use their own temporary YAML files. Configuration files are cached for the process lifetime. Validation reports field paths and requirements without including credential values or YAML source lines.

For Agent tracing, configure `http.host` and `observability` in `agent.yaml` before running `make dev-observability`; the command starts the collector profile and enables server/Web telemetry. See [observability](observability.md#local-startup) for the YAML values.

When upgrading an older checkout, move its Agent settings into these sections before deleting the old root `.env`. In particular, move all chat and embedding API keys to `models.yaml`, and preserve database URLs, workflow token and sandbox key in `agent.yaml`. Endpoint/model/dimension changes affect the embedding index profile and may require reindexing; a file migration that retains those values does not.

For an older `models.yaml`, rename `context_window_tokens` to `max_input_tokens` and replace nested thinking settings with the unified level. Disabled thinking becomes `thinking: disabled`; enabled DeepSeek native efforts `low`, `high`, `max` become `low`, `medium`, `high`, and enabled Qwen native efforts `low`, `medium`, `xhigh` become `low`, `medium`, `high`. Choose an explicit level when migrating a Qwen `budget_tokens` setting; numeric thinking budgets are no longer supported. Preserve stable model IDs, keys, addresses and existing input/output overrides. Removing an output override deliberately adopts the documented mode-specific default. Obsolete or unknown fields fail validation so configuration mistakes do not silently change request behavior.
