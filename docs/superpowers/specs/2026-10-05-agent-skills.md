# Agent Skills with a local script sandbox

The user approved a first working version of standard `SKILL.md` bundles, including scripts, file processing, external API access and downloadable results. Execution uses locally deployed Docker; implementation stays in the current checkout, as requested.

## Boundaries

- Project maintainers publish directories under `skills/`. Ordinary users upload input files, not executable Skill bundles.
- Python discovers metadata and exposes `load_skill`, `read_skill_file` and `run_skill_script` as ordinary LangChain tools. Keep the existing `create_agent`, workflows, checkpointing and tool transcript.
- OpenSandbox's Python SDK supplies commands, file transfer and lifecycle management. Compose manages its local control server. A dedicated image contains Python, Bash, Node and common file-processing dependencies.
- Aegra's graph factory owns one lazily created sandbox per worker execution. Multiple script calls share `/workspace`; separate runs get separate sandboxes. Worker completion, failure and cancellation release it; a finite server TTL covers process crashes. Workspaces do not persist across turns or human-review resumes.
- Only scripts present in a published Skill run. Interpreter selection follows `.py`, `.sh` or `.js`; arguments are individually shell-quoted. Skill files cannot escape their root through traversal or symlinks.
- Administrator configuration defines network destinations and explicitly passed script environment variables. Default egress denies access except configured hosts. Host environment, repository files and Docker socket are never copied into script sandboxes.
- Bound execution to one CPU, 512 MiB, 256 processes, a 120-second script deadline, 20-minute sandbox TTL and bounded logs. File transfers are limited to 10 MiB per file, four inputs and four declared outputs per call.
- TypeScript stores input and output bytes in S3-compatible object storage; PostgreSQL keeps object keys, hashes, readiness and ownership metadata. The server serves downloads scoped to a live conversation. Internal access requires the existing shared workflow credential and verifies conversation/run ownership. Deleted conversations immediately lose download access; a retryable cleanup worker removes their S3 objects before dropping metadata. Failed uploads keep non-downloadable intents for same-ID retries or deletion.
- The composer accepts input attachments, displays upload failures and preserves the prompt on failure. Official user messages include file IDs for the agent. Download links for script outputs remain visible independently of the collapsed tool process and survive transcript recovery.
- Add a CSV summary Skill and a public HTTP query Skill as runnable examples. Do not automatically retry scripts or external writes after unknown outcomes.

## Validation

Cover catalog/path validation, script failures, timeouts, cancellation cleanup, same-run reuse, cross-run isolation, input/output transfer and malformed artifact requests. Run existing cross-project checks. A controlled-model graph test proves tool wiring; a live Docker smoke proves all three interpreters, HTTP access and file transfer. Real-model smoke is reported separately.

## Known first-version limits

No marketplace, runtime bundle upload, arbitrary model-generated code, cross-turn workspace persistence or general-purpose job scheduler. The application retains its existing shared-workspace trust model. Docker container isolation is not a VM-grade boundary for hostile tenant workloads. Per-host egress controls do not restrict HTTP methods; configured credentialed APIs and their side effects remain the maintainer's responsibility.
