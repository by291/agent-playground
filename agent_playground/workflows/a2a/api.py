"""Submit one durable collaboration job with replay-safe identity."""

import httpx
from pydantic import ValidationError

from agent_playground.config.agent import (
    app_api_url,
    load_agent_config,
    workflow_api_token,
)
from agent_playground.services.a2a.contracts import CollaborationRequest


class HttpA2aApi:
    def __init__(self):
        self.base_url = load_agent_config().a2a.demo_api_url

    async def submit(
        self, *, task_id: str, task: str, callback_token: str, require_input: bool
    ) -> None:
        internal_token = workflow_api_token()

        async with httpx.AsyncClient(timeout=30) as client:
            try:
                request = CollaborationRequest(
                    id=task_id,
                    task=task,
                    callbackToken=callback_token,
                    requireInput=require_input,
                )
            except ValidationError:
                await self.reject(
                    client, task_id, callback_token, "Invalid A2A request."
                )

                return

            submission_error: httpx.HTTPError | None = None
            write_unconfirmed = False

            try:
                if await self.accepted(client, request):
                    return
            except httpx.HTTPError as error:
                submission_error = error
                write_unconfirmed = True

            for _ in range(2):
                response = None

                try:
                    response = await client.post(
                        f"{self.base_url}/jobs",
                        headers={"Authorization": f"Bearer {internal_token}"},
                        json=request.model_dump(by_alias=True),
                    )
                except httpx.TransportError as error:
                    submission_error = error

                if response is not None:
                    definite_rejection = (
                        400 <= response.status_code < 500
                        and response.status_code not in {408, 429}
                    )

                    # A later rejection cannot disprove an earlier accepted write
                    # whose response was lost. Preserve the checkpointed identity.
                    if definite_rejection and not write_unconfirmed:
                        await self.reject(
                            client,
                            task_id,
                            callback_token,
                            f"A2A submission rejected (HTTP {response.status_code}).",
                        )

                        return

                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError as error:
                        submission_error = error
                    else:
                        if response.json().get("jobId") != task_id:
                            raise ValueError(
                                "A2A submission receipt targets a different task"
                            )

                        return

                write_unconfirmed = True

                try:
                    if await self.accepted(client, request):
                        return
                except httpx.HTTPError as error:
                    submission_error = error

            if submission_error is not None:
                raise submission_error

    async def accepted(
        self, client: httpx.AsyncClient, request: CollaborationRequest
    ) -> bool:
        receipt = await client.get(
            f"{self.base_url}/jobs/{request.id}",
            headers={"Authorization": f"Bearer {request.callback_token}"},
        )

        if receipt.status_code == 404:
            return False

        receipt.raise_for_status()
        data = receipt.json()

        if (data.get("jobId"), data.get("task"), data.get("requireInput")) != (
            request.id,
            request.task,
            request.require_input,
        ):
            raise ValueError("A2A job does not match the checkpointed request")

        return True

    async def reject(
        self, client: httpx.AsyncClient, task_id: str, callback_token: str, error: str
    ) -> None:
        response = await client.post(
            f"{app_api_url()}/external-tasks/{task_id}/events",
            headers={"Authorization": f"Bearer {callback_token}"},
            json={
                "revision": 1,
                "kind": "a2a",
                "status": "failed",
                "stage": "submission",
                "message": "A2A submission failed",
                "error": error,
            },
        )
        response.raise_for_status()
