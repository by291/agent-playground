"""Exercise real OpenSandbox interpreters, files, network policy and cleanup."""

import asyncio
import json
import subprocess
import tempfile
from dataclasses import replace
from pathlib import Path

from agent_playground.skills.catalog import SkillCatalog
from agent_playground.skills.sandbox import SandboxSettings, SkillSession


async def main():
    settings = SandboxSettings.from_config()
    catalog = SkillCatalog(Path("skills"))

    async with SkillSession(catalog, settings) as session:
        result = await session.run(
            "csv-summary",
            "scripts/summarize.py",
            ["/workspace/inputs/sample.csv", "/workspace/summary.json"],
            {"inputs/sample.csv": b"item,amount\nalpha,12\nbeta,8\n"},
            ["summary.json"],
        )
        assert result.exit_code == 0, result
        assert (
            json.loads(result.outputs["summary.json"])["numericTotals"]["amount"] == 20
        )
        sandbox_id = session.sandbox.id
        containers = (
            await asyncio.to_thread(
                subprocess.check_output,
                ["docker", "ps", "-q", "--filter", f"name={sandbox_id}"],
                text=True,
            )
        ).split()
        assert containers, "Smoke sandbox containers were not found"
        bindings = json.loads(
            await asyncio.to_thread(
                subprocess.check_output, ["docker", "inspect", *containers], text=True
            )
        )
        published = [
            port
            for container in bindings
            for ports in (container["HostConfig"]["PortBindings"] or {}).values()
            for port in ports
        ]
        assert published and all(port["HostIp"] == "127.0.0.1" for port in published), (
            "Sandbox ports must bind only to loopback"
        )
        result = await session.run(
            "http-query",
            "scripts/fetch.py",
            ["https://httpbin.org/get", "/workspace/response.json"],
            {},
            ["response.json"],
        )
        assert result.exit_code == 0, result
        assert (
            json.loads(result.outputs["response.json"])["url"]
            == "https://httpbin.org/get"
        )
        assert session.sandbox.id == sandbox_id
        result = await session.run(
            "http-query",
            "scripts/fetch.py",
            ["https://example.com", "/workspace/blocked.json"],
            {},
            [],
        )
        assert result.exit_code != 0, "Unlisted network access unexpectedly succeeded"

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory) / "runtime-check"
        (root / "scripts").mkdir(parents=True)
        (root / "SKILL.md").write_text(
            "---\nname: runtime-check\ndescription: Runtime smoke fixture.\n---\n"
        )
        (root / "scripts/main.sh").write_text("test $(id -u) = 1000 && printf bash-ok")
        (root / "scripts/main.js").write_text(
            "if (process.getuid() !== 1000) process.exit(1); console.log('node-ok');"
        )
        (root / "scripts/sleep.py").write_text("import time\ntime.sleep(60)")
        fixture = SkillCatalog(Path(directory))

        async with SkillSession(fixture, settings) as session:
            for script, expected in (("main.sh", "bash-ok"), ("main.js", "node-ok")):
                result = await session.run(
                    "runtime-check", f"scripts/{script}", [], {}, []
                )
                assert result.exit_code == 0 and expected in result.stdout, result

        async with SkillSession(
            fixture, replace(settings, command_timeout=1)
        ) as session:
            try:
                await session.run("runtime-check", "scripts/sleep.py", [], {}, [])
            except TimeoutError:
                assert session.closed and session.sandbox is None
            else:
                raise AssertionError("Timeout did not terminate the sandbox")

    print(
        "Skill smoke passed: CSV, HTTP allow/deny, Python/Bash/Node, reuse and timeout cleanup."
    )


if __name__ == "__main__":
    asyncio.run(main())
