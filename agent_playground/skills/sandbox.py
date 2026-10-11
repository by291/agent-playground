"""Own a lazy OpenSandbox environment for one agent worker execution."""

import asyncio
import json
import shlex
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from opensandbox import Sandbox
from opensandbox.config import ConnectionConfig
from opensandbox.models.execd import ExecutionHandlers, OutputMessage, RunCommandOpts
from opensandbox.models.filesystem import WriteEntry
from opensandbox.models.sandboxes import NetworkPolicy, NetworkRule

from agent_playground.config.agent import load_agent_config
from agent_playground.skills.catalog import MAX_FILE_BYTES, SkillCatalog, relative_path

MAX_LOG_CHARS = 32 * 1024
EXPORT_CHECK = """
import json, pathlib, sys
root = pathlib.Path('/workspace')
for name in json.loads(sys.argv[1]):
    path = root / name
    if any(part.is_symlink() for part in [path, *path.parents]):
        raise ValueError('Output files must not be symlinks')
    if not path.is_file() or path.stat().st_size > 10485760:
        raise ValueError('Output is missing, not a regular file, or exceeds 10 MiB')
print('Outputs validated')
"""


@dataclass(frozen=True)
class SandboxSettings:
    url: str = "http://127.0.0.1:8080"
    api_key: str = "agent-playground-local-sandbox"
    image: str = "agent-playground-skill-runtime:local"
    command_timeout: float = 120
    allowed_hosts: tuple[str, ...] = ("httpbin.org",)
    environment: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_config(cls):
        config = load_agent_config().skills

        return cls(
            url=config.sandbox_url,
            api_key=config.sandbox_api_key.get_secret_value(),
            image=config.sandbox_image,
            command_timeout=config.command_timeout,
            allowed_hosts=tuple(config.allowed_hosts),
            environment={
                name: value.get_secret_value()
                for name, value in config.script_environment.items()
            },
        )


@dataclass(frozen=True)
class ScriptResult:
    exit_code: int | None
    stdout: str
    stderr: str
    error: str | None
    outputs: dict[str, bytes]


class SkillSession:
    """Serialize scripts in one lazily created sandbox owned by the worker run."""

    def __init__(self, catalog: SkillCatalog, settings: SandboxSettings):
        self.catalog = catalog
        self.settings = settings

        self.sandbox: Sandbox | None = None
        self.lock = asyncio.Lock()
        self.closed = False
        self.staged: set[str] = set()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_: object):
        await self.close()

    async def close(self):
        # Retire the session before awaiting destruction so no later call reuses it.
        self.closed = True
        sandbox = self.sandbox
        self.sandbox = None

        if sandbox is not None:
            await sandbox.destroy()

    async def _prepare(self, skill_name: str) -> Sandbox:
        if self.closed:
            raise ValueError("The script workspace ended; start a new agent run")

        if self.sandbox is None:
            address = urlsplit(self.settings.url)
            config = ConnectionConfig(
                api_key=self.settings.api_key,
                domain=address.netloc,
                protocol=address.scheme,
                request_timeout=timedelta(seconds=150),
                use_server_proxy=True,
                disable_metrics=True,
            )
            self.sandbox = await Sandbox.create(
                self.settings.image,
                connection_config=config,
                timeout=timedelta(minutes=20),
                ready_timeout=timedelta(seconds=60),
                resource={"cpu": "1", "memory": "512Mi"},
                env=self.settings.environment,
                network_policy=NetworkPolicy(
                    default_action="deny",
                    egress=[
                        NetworkRule(action="allow", target=host)
                        for host in self.settings.allowed_hosts
                    ],
                ),
            )

        sandbox = self.sandbox

        if skill_name not in self.staged:
            skill = self.catalog.get(skill_name)
            directories = {"/skills", f"/skills/{skill.name}"}

            for name in skill.files:
                parent = PurePosixPath(f"/skills/{skill.name}/{name}").parent
                directories.update(
                    str(path) for path in [parent, *parent.parents] if str(path) != "/"
                )

            await sandbox.files.create_directories(
                [WriteEntry(path=path, mode=755) for path in sorted(directories)]
            )
            await sandbox.files.write_files(
                [
                    WriteEntry(path=f"/skills/{skill.name}/{name}", data=data, mode=444)
                    for name, data in skill.files.items()
                ]
            )
            self.staged.add(skill_name)

        return sandbox

    async def _stage_inputs(self, sandbox: Sandbox, inputs: dict[str, bytes]) -> None:
        for name, data in inputs.items():
            path = f"/workspace/{relative_path(name)}"
            await sandbox.files.create_directories(
                [
                    WriteEntry(
                        path=str(PurePosixPath(path).parent),
                        mode=755,
                        owner="skill",
                        group="skill",
                    )
                ]
            )
            await sandbox.files.write_files(
                [
                    WriteEntry(
                        path=path,
                        data=data,
                        mode=644,
                        owner="skill",
                        group="skill",
                    )
                ]
            )

    async def _export_outputs(
        self, sandbox: Sandbox, outputs: list[str]
    ) -> dict[str, bytes]:
        # Validate inside the sandbox before reading: host path checks cannot see
        # sandbox symlinks or distinguish a regular file from a special file.
        check = await sandbox.commands.run(
            shlex.join(["python", "-c", EXPORT_CHECK, json.dumps(outputs)]),
            opts=RunCommandOpts(working_directory="/workspace", uid=1000, gid=1000),
        )

        if check.exit_code != 0 or check.error:
            raise ValueError("Output is missing, unsafe or exceeds 10 MiB")

        exported: dict[str, bytes] = {}

        for path in outputs:
            data = await sandbox.files.read_bytes(
                f"/workspace/{path}",
                range_header=f"bytes=0-{MAX_FILE_BYTES}",
            )

            if len(data) > MAX_FILE_BYTES:
                raise ValueError("Output file exceeds 10 MiB")

            exported[path] = data

        return exported

    async def run(
        self,
        skill_name: str,
        script_path: str,
        arguments: list[str],
        inputs: dict[str, bytes],
        output_files: list[str],
    ) -> ScriptResult:
        """Run one published script and destroy the workspace on ambiguous failure."""
        skill = self.catalog.get(skill_name)
        script = relative_path(script_path)
        interpreter = {".py": "python", ".sh": "bash", ".js": "node"}.get(
            PurePosixPath(script).suffix
        )

        if (
            script not in skill.files
            or interpreter is None
            or not script.startswith("scripts/")
        ):
            raise ValueError("Run a published .py, .sh or .js file under scripts/")

        if len(inputs) > 4 or len(output_files) > 4 or len(arguments) > 64:
            raise ValueError("Use at most four inputs, four outputs and 64 arguments")

        outputs = [relative_path(path) for path in output_files]

        if any(len(data) > MAX_FILE_BYTES for data in inputs.values()):
            raise ValueError("Input file exceeds 10 MiB")

        command = shlex.join(
            [interpreter, f"/skills/{skill_name}/{script}", *arguments]
        )

        if len(command) > 16384:
            raise ValueError("Script arguments exceed 16 KiB")

        # Staging, execution and export share mutable files; keep them under one lock.
        async with self.lock:
            try:
                sandbox = await self._prepare(skill_name)

                async with asyncio.timeout(self.settings.command_timeout):
                    await self._stage_inputs(sandbox, inputs)

                    log_size = 0

                    async def bound_log(message: OutputMessage):
                        nonlocal log_size
                        log_size += len(message.text)

                        if log_size > MAX_LOG_CHARS * 2:
                            raise ValueError("Script exceeded the 64 KiB log limit")

                    execution = await sandbox.commands.run(
                        command,
                        opts=RunCommandOpts(
                            working_directory="/workspace",
                            timeout=timedelta(seconds=self.settings.command_timeout),
                            uid=1000,
                            gid=1000,
                        ),
                        handlers=ExecutionHandlers(
                            on_stdout=bound_log, on_stderr=bound_log
                        ),
                    )
                    error = execution.error.value if execution.error else None
                    exported: dict[str, bytes] = {}

                    if execution.exit_code == 0 and error is None and outputs:
                        exported = await self._export_outputs(sandbox, outputs)

                    return ScriptResult(
                        execution.exit_code,
                        "\n".join(line.text for line in execution.logs.stdout)[
                            :MAX_LOG_CHARS
                        ],
                        "\n".join(line.text for line in execution.logs.stderr)[
                            :MAX_LOG_CHARS
                        ],
                        error,
                        exported,
                    )
            except BaseException:
                # Caller cancellation must still terminate a possibly running script.
                await asyncio.shield(self.close())
                raise


current_session: ContextVar[SkillSession | None] = ContextVar(
    "skill_session", default=None
)


@asynccontextmanager
async def skill_execution(catalog: SkillCatalog):
    """Bind tools to the worker's session and release its workspace on exit."""
    async with SkillSession(catalog, SandboxSettings.from_config()) as session:
        token = current_session.set(session)

        try:
            yield session
        finally:
            current_session.reset(token)
