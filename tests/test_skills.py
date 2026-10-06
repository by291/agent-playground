"""Validate published bundles and the script execution lifecycle."""

import asyncio
import shlex
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from opensandbox.models.execd import Execution, ExecutionLogs, OutputMessage
from opensandbox.models.filesystem import EntryInfo, WriteEntry

from agent_playground.skills.catalog import SkillCatalog
from agent_playground.skills.sandbox import SandboxSettings, SkillSession


def make_catalog(tmp_path: Path) -> SkillCatalog:
    root = tmp_path / "skills" / "example"
    (root / "scripts").mkdir(parents=True)
    (root / "SKILL.md").write_text(
        "---\nname: example\ndescription: Summarize a file.\n---\nRun scripts/main.py."
    )
    (root / "scripts/main.py").write_text("print('done')")

    return SkillCatalog(tmp_path / "skills")


def test_catalog_discovers_metadata_and_reads_only_published_files(tmp_path: Path):
    catalog = make_catalog(tmp_path)

    assert "example: Summarize a file." in catalog.prompt()
    assert "Run scripts/main.py." in catalog.read("example", "SKILL.md")

    for path in ("../secret", "/etc/passwd", "scripts/../../secret"):
        with pytest.raises(ValueError, match="relative|published"):
            catalog.read("example", path)


def test_catalog_rejects_symlinks(tmp_path: Path):
    make_catalog(tmp_path)
    root = tmp_path / "skills/example"

    try:
        (root / "references").symlink_to(tmp_path, target_is_directory=True)
    except OSError as error:
        if getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows requires symlink privileges or Developer Mode")

        raise

    with pytest.raises(ValueError, match="symlink"):
        SkillCatalog(tmp_path / "skills")


def test_catalog_rejects_invalid_metadata(tmp_path: Path):
    make_catalog(tmp_path)
    root = tmp_path / "skills/example"
    (root / "SKILL.md").write_text("---\nname: wrong\ndescription: test\n---\n")

    with pytest.raises(ValueError, match="directory"):
        SkillCatalog(tmp_path / "skills")


class FakeFiles:
    def __init__(self):
        self.data: dict[str, bytes] = {}

    async def create_directories(self, entries: list[WriteEntry]):
        pass

    async def write_files(self, entries: list[WriteEntry]):
        for entry in entries:
            data = entry.data
            assert isinstance(data, (str, bytes))
            self.data[entry.path] = data.encode() if isinstance(data, str) else data

    async def get_file_info(self, paths: list[str]):
        return {
            path: EntryInfo(
                path=path,
                type="file",
                mode=644,
                owner="skill",
                group="skill",
                size=len(self.data[path]),
                modified_at=datetime.now(UTC),
                created_at=datetime.now(UTC),
            )
            for path in paths
        }

    async def read_bytes(self, path: str):
        return self.data[path]


class FakeCommands:
    def __init__(self):
        self.commands: list[str] = []
        self.failure = False
        self.stall = False

    async def run(self, command: str, **kwargs: Any):
        self.commands.append(command)

        if self.stall:
            await asyncio.Event().wait()

        return Execution(
            exit_code=7 if self.failure else 0,
            logs=ExecutionLogs(stdout=[OutputMessage(text="done", timestamp=0)]),
        )


class FakeSandbox:
    def __init__(self):
        self.files = FakeFiles()
        self.commands = FakeCommands()
        self.destroyed = False

    async def destroy(self):
        self.destroyed = True


def test_session_reuses_sandbox_and_quotes_arguments(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    catalog = make_catalog(tmp_path)
    sandbox = FakeSandbox()
    creations: list[dict[str, Any]] = []

    async def create(*args: Any, **kwargs: Any):
        creations.append(kwargs)
        return sandbox

    monkeypatch.setattr("agent_playground.skills.sandbox.Sandbox.create", create)

    async def check():
        async with SkillSession(catalog, SandboxSettings()) as session:
            result = await session.run(
                "example", "scripts/main.py", ["x; touch /tmp/escape"], {}, []
            )
            assert result.exit_code == 0
            assert result.stdout == "done"
            await session.run("example", "scripts/main.py", [], {}, [])

        assert len(creations) == 1
        assert creations[0]["network_policy"].default_action == "deny"
        assert shlex.split(sandbox.commands.commands[0]) == [
            "python",
            "/skills/example/scripts/main.py",
            "x; touch /tmp/escape",
        ]
        assert sandbox.destroyed

    asyncio.run(check())


def test_session_returns_nonzero_exit_and_cleans_up_after_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    catalog = make_catalog(tmp_path)
    sandbox = FakeSandbox()

    async def create(*args: Any, **kwargs: Any):
        return sandbox

    monkeypatch.setattr("agent_playground.skills.sandbox.Sandbox.create", create)

    async def check():
        async with SkillSession(
            catalog, SandboxSettings(command_timeout=0.02)
        ) as session:
            sandbox.commands.failure = True
            result = await session.run("example", "scripts/main.py", [], {}, [])
            assert result.exit_code == 7
            sandbox.commands.stall = True

            with pytest.raises(TimeoutError):
                await session.run("example", "scripts/main.py", [], {}, [])

            assert sandbox.destroyed

    asyncio.run(check())


def test_cancellation_destroys_sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    sandbox = FakeSandbox()
    sandbox.commands.stall = True

    async def create(*args: Any, **kwargs: Any):
        return sandbox

    monkeypatch.setattr("agent_playground.skills.sandbox.Sandbox.create", create)

    async def check():
        async with SkillSession(make_catalog(tmp_path), SandboxSettings()) as session:
            task = asyncio.create_task(
                session.run("example", "scripts/main.py", [], {}, [])
            )
            await asyncio.sleep(0.01)
            task.cancel()

            with pytest.raises(asyncio.CancelledError):
                await task

            assert sandbox.destroyed

    asyncio.run(check())


def test_catalog_accepts_delimiter_text_inside_yaml_values(tmp_path: Path):
    make_catalog(tmp_path)
    (tmp_path / "skills/example/SKILL.md").write_text(
        '---\nname: example\ndescription: "Parse --- separators."\n---\nUse the published script.\n'
    )

    catalog = SkillCatalog(tmp_path / "skills")

    assert catalog.get("example").description == "Parse --- separators."
    assert "Use the published script." in catalog.read("example", "SKILL.md")
