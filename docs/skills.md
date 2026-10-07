# Agent Skills

[Documentation index](README.md) · [Local development and S3](development.md)

## Usage

A Skill is a maintainer-published `SKILL.md` bundle with optional `scripts/`, `references/` and `assets/`. The agent first sees names/descriptions, selects a Skill for the request or an explicit `$skill-name`, then reads its instructions and executes published scripts.

| Tool               | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `load_skill`       | Read a Skill's `SKILL.md`.                                     |
| `read_skill_file`  | Read supporting text in the bundle.                            |
| `run_skill_script` | Execute Python, Bash or Node files under `scripts/` in Docker. |

Try these chat requests:

- **"$csv-summary Summarize the sample CSV and provide summary.json."** uses the bundled sample.
- Attach a CSV and send **"$csv-summary Summarize the attached file."**.
- **"$http-query Fetch https://httpbin.org/get and provide response.json."** tests permitted outbound HTTP access.

Skill calls are grouped by name with a **Skill** label and execution status. Expand to inspect script/resource paths, arguments and results. Ordinary tools share the style with a **Tool** label. Recovered history uses the same presentation; generated files have separate download links.

## Publishing bundles

The default location is `skills/<name>/` in the repository. Override it through root `SKILL_DIRECTORY` if needed. Names must match their directory and use lowercase letters, digits and hyphens. YAML frontmatter in `SKILL.md` requires a name and nonempty description:

```markdown
---
name: csv-summary
description: Summarize CSV files and deliver a JSON summary.
---

Read the request, identify the input file, run the published script and deliver its declared output.
```

See complete examples in [csv-summary](../skills/csv-summary/SKILL.md) and [http-query](../skills/http-query/SKILL.md). Bundles cannot contain symlinks. Each bundle has at most 200 files and 10 MiB total; `SKILL.md` and readable text resources are each limited to 32 KiB. Instructions/scripts are published as read-only files without host filesystem access.

Restart the agent after adding or editing a Skill because the catalog and graph are cached. Chat attachments are inputs; they cannot publish new Skills or arbitrary scripts.

## Attachments and outputs

**Attach files** selects at most four files, each up to 10 MiB, with a 100 MiB conversation quota. Selection neither uploads nor allocates a thread ID. The first valid send allocates the thread, uploads files and then submits the message.

The TypeScript server writes bytes to S3. PostgreSQL stores object keys, digests, sizes, publication state and conversation ownership. Upload failures preserve the draft and selected files. Retrying the same ID/content is supported; conflicting content returns `409`. Incomplete uploads cannot be downloaded until a retry succeeds or the conversation is deleted.

Regular chat also sends supported image attachments directly to the model, while keeping their file IDs available for scripts. See [image input and limits](conversations.md). Non-image files still require a published Skill that can process their format.

Scripts receive current-conversation file IDs through `input_files`, at `/workspace/inputs/<id>/<name>`. `output_files` declares paths relative to `/workspace`. Published files appear as downloads and recover after reload. Tool results report the actual exit code, logs, errors and successfully published files.

Internal transfers use `WORKFLOW_API_TOKEN` and `APP_API_URL`. Inputs are checked against conversation ownership; outputs must also belong to an existing run. S3 settings are shared with knowledge documents; see [storage configuration](development.md#s3-compatible-storage). S3 credentials are not sent to the browser or scripts.

Deleting a conversation immediately revokes file downloads. The server attempts S3 cleanup every 30 seconds; failures retain metadata for later passes or restart. Successful cleanup retains a metadata tombstone and scans one `skill-files/` object-list page per pass, so uploads that finish remotely after a timeout can be found and deleted again. S3 credentials require list, get, put and delete permissions for these objects. Shared knowledge documents have their own lifecycle and survive conversation deletion.

## Execution environment and lifecycle

`make dev` / `make infra-up` includes OpenSandbox and SeaweedFS by default, without a profile. Observability uses a separate optional profile. Maintainers build the Skill runtime with Python, Bash, Node, httpx, pandas, openpyxl and pypdf; see the [Dockerfile](../infra/skills/runtime.Dockerfile).

Each Aegra worker execution lazily creates one Docker sandbox. Calls in that execution share `/workspace`, which is destroyed on completion, failure or cancellation. A 20-minute TTL collects sandboxes left by process crashes. A later conversation turn or review resume creates a new workspace, requiring input file IDs to be supplied again.

| Limit                   | Current value                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Identity                | UID/GID 1000.                                                                                           |
| Resources               | 1 CPU, 512 MiB memory, 256 processes.                                                                   |
| Script call             | Up to 120 seconds; `.py`, `.sh` or `.js`; arguments passed literally.                                   |
| Inputs/declared outputs | At most four each, up to 10 MiB per file.                                                               |
| Logs                    | At most 65,536 characters across stdout/stderr; each returned stream is truncated to 32,768 characters. |
| Egress                  | Root `SKILL_ALLOWED_HOSTS`, defaulting to `httpbin.org`.                                                |
| Environment             | Only names explicitly listed in `SKILL_SCRIPT_ENV`; not the entire agent environment.                   |

Scripts do not mount the repository, host files or Docker socket. The OpenSandbox control service holds the socket; its published API and dynamic execution ports are limited to loopback. Local configuration uses the official `release-1.1.1-rc.1` image with native `[docker] publish_host = "127.0.0.1"` in [sandbox.toml](../infra/skills/sandbox.toml), without a startup patch. This is a prerelease image; Compose/runtime configuration records the pinned version.

The implementation has no cross-turn workspace, arbitrary-code tool or Skill upload marketplace. Host rules do not limit HTTP methods. External writes require business idempotency and outcome confirmation; timeouts/failures are not automatically retried. Docker isolation is not a VM boundary for untrusted tenants.

## Verification

Configure the model, internal token and S3 through [local development](development.md), then run:

```sh
make dev
make skills-smoke
```

The smoke checks actual Python/Bash/Node scripts, permitted/blocked network access, sandbox file I/O, workspace reuse, timeout cleanup and container port bindings. Skill cases in `pnpm test:e2e` validate browser/backend/S3 with a controlled agent. [Live smoke](../web/tests/e2e/README.md#live-smoke) separately connects to the Python agent, configured model and local OpenSandbox. Record those validation results separately.
