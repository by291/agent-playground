"""Expose Skill instructions, resources and script results as ordinary tools."""

import json
import logging
from functools import cache
from pathlib import Path

from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool

from agent_playground.config.agent import load_agent_config
from agent_playground.config.reader import PROJECT_ROOT
from agent_playground.skills.catalog import SkillCatalog
from agent_playground.skills.files import SkillFileClient
from agent_playground.skills.sandbox import (
    MAX_SCRIPT_FILES,
    ScriptInvocation,
    current_session,
)

MAX_SCRIPT_ERROR_CHARS = 2000


@cache
def default_catalog() -> SkillCatalog:
    """Load the process-local catalog from the configured publishing directory."""
    root = Path(load_agent_config().skills.directory)

    if not root.is_absolute():
        root = PROJECT_ROOT / root

    return SkillCatalog(root)


def skill_tools(catalog: SkillCatalog) -> list[BaseTool]:
    """Bind the Skill toolset to a published catalog."""

    @tool
    def load_skill(skill_name: str) -> str:
        """Read a published Skill's SKILL.md instructions before using its scripts."""
        try:
            return catalog.read(skill_name, "SKILL.md")
        except ValueError as error:
            return f"Skill loading failed: {error}"

    @tool
    def read_skill_file(skill_name: str, path: str) -> str:
        """Read a supporting text file relative to the published Skill directory."""
        try:
            return catalog.read(skill_name, path)
        except (ValueError, UnicodeDecodeError) as error:
            return f"Skill resource reading failed: {error}"

    # LangChain derives the existing model-facing argument schema from this signature.
    @tool
    async def run_skill_script(
        skill_name: str,
        script_path: str,
        runtime: ToolRuntime,
        arguments: list[str] | None = None,
        input_files: list[str] | None = None,
        output_files: list[str] | None = None,
    ) -> ToolMessage:
        """Run a published scripts/*.py, *.sh or *.js file in Docker. Arguments are literal strings. Stage up to four uploaded file IDs at /workspace/inputs/<id>/<name>. Declare up to four output paths relative to /workspace to deliver downloads. Scripts share files only within this agent run."""
        payload: dict[str, object] = {
            "kind": "skill_script_result",
            "exitCode": None,
            "stdout": "",
            "stderr": "",
            "error": None,
            "files": [],
        }

        try:
            requested_inputs = input_files or []
            requested_outputs = output_files or []

            if (
                len(requested_inputs) > MAX_SCRIPT_FILES
                or len(requested_outputs) > MAX_SCRIPT_FILES
            ):
                raise ValueError("Use at most four input files and four outputs")

            session = current_session.get()

            if session is None:
                raise ValueError(
                    "Skill scripts require an active agent worker execution"
                )

            configurable = runtime.config.get("configurable") or {}
            metadata = runtime.config.get("metadata") or {}
            thread_id = configurable.get("thread_id")
            run_id = metadata.get("agui_run_id")

            files: SkillFileClient | None = None
            inputs: dict[str, bytes] = {}

            if input_files or output_files:
                if (
                    not isinstance(thread_id, str)
                    or not isinstance(run_id, str)
                    or not runtime.tool_call_id
                ):
                    raise ValueError(
                        "Skill file transfer requires conversation and run identity"
                    )

                files = SkillFileClient(thread_id, run_id, runtime.tool_call_id)
                inputs = await files.inputs(requested_inputs)

            # Script execution and output publication have different retry safety:
            # publication failure must not cause an already completed script to rerun.
            result = await session.run(
                ScriptInvocation(
                    skill_name=skill_name,
                    script_path=script_path,
                    arguments=arguments or [],
                    inputs=inputs,
                    output_files=requested_outputs,
                )
            )

            payload.update(
                {
                    "exitCode": result.exit_code,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "error": result.error,
                }
            )

            if result.exit_code != 0 and not result.error:
                payload["error"] = (
                    f"Script exited with code {result.exit_code}; confirm any external side effects before retrying"
                )

            if files and result.outputs:
                published, publication_error = await files.publish(result.outputs)
                payload["files"] = [
                    file.model_dump(mode="json", by_alias=True) for file in published
                ]

                if publication_error:
                    payload["error"] = (
                        f"Script completed but output publication failed: {publication_error}. Do not rerun the script to retry a file transfer."
                    )
        except TimeoutError:
            payload["error"] = (
                "Script timed out; its sandbox was terminated. Confirm any external side effects before retrying."
            )
        except Exception as error:
            logging.getLogger(__name__).exception("Skill script invocation failed")
            payload["error"] = (
                f"Script failed or its outcome could not be confirmed: {error}"[
                    :MAX_SCRIPT_ERROR_CHARS
                ]
            )

        content = json.dumps(payload)
        status = "error" if payload["error"] else "success"

        return ToolMessage(
            content=content,
            tool_call_id=runtime.tool_call_id or "skill-script",
            status=status,
        )

    return [
        load_skill,
        read_skill_file,
        run_skill_script,
    ]
