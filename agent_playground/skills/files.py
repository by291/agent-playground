"""Transfer conversation-owned files through the authenticated application API."""

import base64
from pathlib import PurePosixPath
from urllib.parse import unquote
from uuid import NAMESPACE_URL, UUID, uuid5

import httpx
from pydantic import BaseModel, ConfigDict, Field

from agent_playground.config.agent import app_api_url, workflow_api_token
from agent_playground.skills.catalog import MAX_FILE_BYTES, relative_path

TRANSFER_TIMEOUT_SECONDS = 30
MAX_TRANSFER_ERROR_CHARS = 1000


class SkillFile(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    thread_id: str = Field(alias="threadId")
    name: str
    size: int = Field(ge=0, le=MAX_FILE_BYTES)


class SkillFileClient:
    def __init__(self, thread_id: str, run_id: str, call_id: str) -> None:
        self.thread_id = thread_id
        self.run_id = run_id
        self.call_id = call_id

        token = workflow_api_token()

        if not token:
            raise ValueError(
                "Skill file transfer requires workflow.api_token in agent.yaml"
            )

        self.headers = {"Authorization": f"Bearer {token}"}

    async def inputs(self, ids: list[str]) -> dict[str, bytes]:
        """Download conversation-owned inputs at their deterministic staging paths."""
        result: dict[str, bytes] = {}

        async with httpx.AsyncClient(timeout=TRANSFER_TIMEOUT_SECONDS) as client:
            for file_id in ids:
                identifier = str(UUID(file_id))
                response = await client.get(
                    f"{app_api_url()}/internal/skill-files/{identifier}",
                    headers=self.headers,
                    params={"threadId": self.thread_id},
                )
                response.raise_for_status()
                encoded_name = response.headers["X-Filename"]
                name = relative_path(unquote(encoded_name))

                if "/" in name or len(response.content) > MAX_FILE_BYTES:
                    raise ValueError("Invalid input file name or size")

                result[f"inputs/{identifier}/{name}"] = response.content

        return result

    async def publish(
        self, outputs: dict[str, bytes]
    ) -> tuple[list[SkillFile], str | None]:
        """Keep published links on partial failure, using retry-stable file identities."""
        result: list[SkillFile] = []

        async with httpx.AsyncClient(timeout=TRANSFER_TIMEOUT_SECONDS) as client:
            for path, content in outputs.items():
                # A matching transfer retry reuses the reserved output identity.
                identifier = str(
                    uuid5(
                        NAMESPACE_URL,
                        f"skill/{self.thread_id}/{self.run_id}/{self.call_id}/{path}",
                    )
                )

                try:
                    encoded_content = base64.b64encode(content).decode("ascii")
                    response = await client.post(
                        f"{app_api_url()}/internal/skill-files",
                        headers=self.headers,
                        json={
                            "id": identifier,
                            "threadId": self.thread_id,
                            "runId": self.run_id,
                            "name": PurePosixPath(path).name,
                            "dataBase64": encoded_content,
                        },
                    )
                    response.raise_for_status()
                    result.append(SkillFile.model_validate(response.json()))
                except (httpx.HTTPError, ValueError) as error:
                    return result, str(error)[:MAX_TRANSFER_ERROR_CHARS]

        return result, None
