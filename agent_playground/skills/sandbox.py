"""Own a lazy OpenSandbox environment for one agent worker execution."""

import asyncio
import json
import shlex
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import PurePosixPath
from typing import Self
from urllib.parse import urlsplit

from opensandbox import Sandbox
from opensandbox.config import ConnectionConfig
from opensandbox.models.execd import ExecutionHandlers, OutputMessage, RunCommandOpts
from opensandbox.models.filesystem import WriteEntry
from opensandbox.models.sandboxes import NetworkPolicy, NetworkRule

from agent_playground.config.agent import load_agent_config
from agent_playground.skills.catalog import MAX_FILE_BYTES, SkillCatalog, relative_path

MAX_LOG_CHARS = 32 * 1024
MAX_COMBINED_LOG_CHARS = 2 * MAX_LOG_CHARS
MAX_SCRIPT_FILES = 4
MAX_SCRIPT_ARGUMENTS = 64
MAX_COMMAND_CHARS = 16 * 1024
SANDBOX_REQUEST_TIMEOUT_SECONDS = 150
SANDBOX_LIFETIME_MINUTES = 20
SANDBOX_READY_TIMEOUT_SECONDS = 60
SKILL_USER_ID = 1000
SKILL_GROUP_ID = 1000
DIRECTORY_MODE = 755
PUBLISHED_FILE_MODE = 444
STAGED_FILE_MODE = 644

SCRIPT_INTERPRETERS = {
    ".py": "python",
    ".sh": "bash",
    ".js": "node",
}
EXPORT_CHECK = """
import json
import pathlib
import sys

root = pathlib.Path('/workspace')
max_file_bytes = int(sys.argv[2])

for name in json.loads(sys.argv[1]):
    path = root / name

    if any(part.is_symlink() for part in [path, *path.parents]):
        raise ValueError('Output files must not be symlinks')

    if not path.is_file() or path.stat().st_size > max_file_bytes:
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
    def from_config(cls) -> Self:
        """Load the settings used to launch a worker-owned sandbox."""
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


@dataclass(frozen=True, kw_only=True)
class ScriptResult:
    exit_code: int | None
    stdout: str
    stderr: str
    error: str | None
    outputs: dict[str, bytes]


@dataclass(frozen=True, kw_only=True)
class ScriptInvocation:
    """Describe a published script and the files crossing its sandbox boundary."""

    skill_name: str
    script_path: str
    arguments: list[str] = field(default_factory=list)
    inputs: dict[str, bytes] = field(default_factory=dict)
    output_files: list[str] = field(default_factory=list)


class SkillSession:
    """Serialize scripts in one lazily created sandbox owned by the worker run."""

    def __init__(self, catalog: SkillCatalog, settings: SandboxSettings) -> None:
        self.catalog = catalog
        self.settings = settings

        self.sandbox: Sandbox | None = None
        self.lock = asyncio.Lock()
        self.closed = False
        self.staged: set[str] = set()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def close(self) -> None:
        """Retire the execution session and destroy its workspace if one exists."""
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
                request_timeout=timedelta(seconds=SANDBOX_REQUEST_TIMEOUT_SECONDS),
                use_server_proxy=True,
                disable_metrics=True,
            )
            self.sandbox = await Sandbox.create(
                self.settings.image,
                connection_config=config,
                timeout=timedelta(minutes=SANDBOX_LIFETIME_MINUTES),
                ready_timeout=timedelta(seconds=SANDBOX_READY_TIMEOUT_SECONDS),
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
                [
                    WriteEntry(path=path, mode=DIRECTORY_MODE)
                    for path in sorted(directories)
                ]
            )
            await sandbox.files.write_files(
                [
                    WriteEntry(
                        path=f"/skills/{skill.name}/{name}",
                        data=content,
                        mode=PUBLISHED_FILE_MODE,
                    )
                    for name, content in skill.files.items()
                ]
            )
            self.staged.add(skill_name)

        return sandbox

    async def _stage_inputs(self, sandbox: Sandbox, inputs: dict[str, bytes]) -> None:
        for name, content in inputs.items():
            path = f"/workspace/{relative_path(name)}"

            await sandbox.files.create_directories(
                [
                    WriteEntry(
                        path=str(PurePosixPath(path).parent),
                        mode=DIRECTORY_MODE,
                        owner="skill",
                        group="skill",
                    )
                ]
            )
            await sandbox.files.write_files(
                [
                    WriteEntry(
                        path=path,
                        data=content,
                        mode=STAGED_FILE_MODE,
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
        command = shlex.join(
            [
                "python",
                "-c",
                EXPORT_CHECK,
                json.dumps(outputs),
                str(MAX_FILE_BYTES),
            ]
        )
        check = await sandbox.commands.run(
            command,
            opts=RunCommandOpts(
                working_directory="/workspace", uid=SKILL_USER_ID, gid=SKILL_GROUP_ID
            ),
        )

        if check.exit_code != 0 or check.error:
            raise ValueError("Output is missing, unsafe or exceeds 10 MiB")

        exported: dict[str, bytes] = {}

        for path in outputs:
            content = await sandbox.files.read_bytes(
                f"/workspace/{path}",
                range_header=f"bytes=0-{MAX_FILE_BYTES}",
            )

            if len(content) > MAX_FILE_BYTES:
                raise ValueError("Output file exceeds 10 MiB")

            exported[path] = content

        return exported

    async def run(self, invocation: ScriptInvocation) -> ScriptResult:
        """Run a published script and destroy the workspace on ambiguous failure."""
        skill = self.catalog.get(invocation.skill_name)
        script = relative_path(invocation.script_path)
        interpreter = SCRIPT_INTERPRETERS.get(PurePosixPath(script).suffix)

        if (
            script not in skill.files
            or interpreter is None
            or not script.startswith("scripts/")
        ):
            raise ValueError("Run a published .py, .sh or .js file under scripts/")

        if (
            len(invocation.inputs) > MAX_SCRIPT_FILES
            or len(invocation.output_files) > MAX_SCRIPT_FILES
            or len(invocation.arguments) > MAX_SCRIPT_ARGUMENTS
        ):
            raise ValueError("Use at most four inputs, four outputs and 64 arguments")

        outputs = [relative_path(path) for path in invocation.output_files]

        if any(len(content) > MAX_FILE_BYTES for content in invocation.inputs.values()):
            raise ValueError("Input file exceeds 10 MiB")

        command = shlex.join(
            [
                interpreter,
                f"/skills/{invocation.skill_name}/{script}",
                *invocation.arguments,
            ]
        )

        if len(command) > MAX_COMMAND_CHARS:
            raise ValueError("Script arguments exceed 16 KiB")

        # Staging, execution and export share mutable files; keep them under one lock.
        async with self.lock:
            try:
                sandbox = await self._prepare(invocation.skill_name)

                async with asyncio.timeout(self.settings.command_timeout):
                    await self._stage_inputs(sandbox, invocation.inputs)

                    return await self._execute(sandbox, command, outputs)
            except BaseException:
                # Caller cancellation must still terminate a possibly running script.
                await asyncio.shield(self.close())
                raise

    async def _execute(
        self, sandbox: Sandbox, command: str, outputs: list[str]
    ) -> ScriptResult:
        log_size = 0

        async def _bound_log(message: OutputMessage) -> None:
            nonlocal log_size
            log_size += len(message.text)

            if log_size > MAX_COMBINED_LOG_CHARS:
                raise ValueError("Script exceeded the 64 KiB log limit")

        execution = await sandbox.commands.run(
            command,
            opts=RunCommandOpts(
                working_directory="/workspace",
                timeout=timedelta(seconds=self.settings.command_timeout),
                uid=SKILL_USER_ID,
                gid=SKILL_GROUP_ID,
            ),
            handlers=ExecutionHandlers(on_stdout=_bound_log, on_stderr=_bound_log),
        )

        error = execution.error.value if execution.error else None
        exported: dict[str, bytes] = {}

        if execution.exit_code == 0 and error is None and outputs:
            exported = await self._export_outputs(sandbox, outputs)

        stdout = "\n".join(line.text for line in execution.logs.stdout)
        stderr = "\n".join(line.text for line in execution.logs.stderr)

        return ScriptResult(
            exit_code=execution.exit_code,
            stdout=stdout[:MAX_LOG_CHARS],
            stderr=stderr[:MAX_LOG_CHARS],
            error=error,
            outputs=exported,
        )


current_session: ContextVar[SkillSession | None] = ContextVar(
    "skill_session", default=None
)


@asynccontextmanager
async def skill_execution(catalog: SkillCatalog) -> AsyncIterator[SkillSession]:
    """Bind tools to the worker's session and release its workspace on exit."""
    async with SkillSession(catalog, SandboxSettings.from_config()) as session:
        token = current_session.set(session)

        try:
            yield session
        finally:
            current_session.reset(token)
