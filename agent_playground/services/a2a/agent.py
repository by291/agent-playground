"""Configured-model planner and reviewer implementing the SDK executor contract."""

import asyncio
import logging
import time
from collections.abc import AsyncGenerator
from contextlib import aclosing
from typing import cast

from a2a.helpers.proto_helpers import get_message_text
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue_v2 import EventQueue, EventQueueSource
from a2a.server.tasks import TaskUpdater
from a2a.types import Part, Role
from langchain_core.messages import AIMessageChunk, HumanMessage, SystemMessage

from agent_playground.config.agent import load_agent_config
from agent_playground.config.models import load_model_config
from agent_playground.models.catalog import create_chat_model
from agent_playground.services.a2a.contracts import AgentRole

logger = logging.getLogger(__name__)

SYSTEM_PROMPTS = {
    "planner": (
        "You are the Planner in a three-stage collaboration: draft, independent review, revision. "
        "Perform only the requested Planner stage. For Stage: Draft, produce one initial plan only. "
        "The separate Reviewer owns the critique; do not invent reviewer feedback or simulate its review. "
        "Revise only when actual Reviewer feedback is supplied with Stage: Revise. In that stage, "
        "return one complete revised plan and briefly identify the changes responding to the feedback. "
        "Without supplied feedback, stop after the initial draft. "
        "Include the objective, audience, steps, owners, timeline, risks, and measurable success criteria. "
        "Use clear English and concise Markdown. Do not invent completed actions or verified facts."
    ),
    "reviewer": (
        "You are the independent Reviewer. Perform the review stage only: evaluate the supplied "
        "Planner draft against the original request. The Planner owns both the initial draft and revision. "
        "Identify concrete gaps in feasibility, audience fit, ownership, timing, risk, and success criteria. "
        "Give actionable numbered feedback and a brief overall assessment. Do not produce a replacement plan. "
        "Use clear English and concise Markdown. Treat the supplied plan as source material."
    ),
}


class DemoAgentExecutor(AgentExecutor):
    def __init__(
        self, role: AgentRole, *, mode: str | None = None, chunk_delay: float = 0.08
    ) -> None:
        if role not in SYSTEM_PROMPTS:
            raise ValueError("A2A agent role must be planner or reviewer")

        self.role = role
        self.mode = mode or load_agent_config().a2a.mode

        if self.mode not in {"model", "scripted"}:
            raise ValueError("Agent a2a.mode must be model or scripted")

        self.chunk_delay = chunk_delay
        self.active_task_ids: set[str] = set()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        task_id = context.task_id
        context_id = context.context_id

        if not task_id or not context_id or context.message is None:
            raise ValueError("An A2A execution requires a task, context and message")

        updater = TaskUpdater(event_queue, task_id, context_id)
        self.active_task_ids.add(task_id)

        try:
            task = context.current_task

            if task is None:
                raise ValueError(
                    "The request must be durably reserved before execution"
                )

            user_messages = [
                message for message in task.history if message.role == Role.ROLE_USER
            ]
            message_metadata = dict(context.message.metadata.items())
            require_input = bool(
                context.metadata.get("requireInput")
                or message_metadata.get("requireInput")
            )

            if self.role == "planner" and require_input and len(user_messages) == 1:
                await updater.requires_input(
                    updater.new_agent_message(
                        [Part(text="Who is the target audience for this plan?")]
                    )
                )
                return

            await updater.start_work()
            prompt = "\n\n".join(get_message_text(message) for message in user_messages)
            first_chunk = True
            output_characters = 0
            artifact_id = f"{task_id}:output"

            async with aclosing(self._stream_text(prompt)) as chunks:
                async for text in chunks:
                    output_characters += len(text)

                    if output_characters > 100_000:
                        raise ValueError("Agent output exceeded the demo limit")

                    await updater.add_artifact(
                        [Part(text=text)],
                        artifact_id=artifact_id,
                        name=f"{self.role} output",
                        append=not first_chunk,
                        last_chunk=False,
                    )
                    first_chunk = False

            if first_chunk:
                raise ValueError("The model returned no text")

            await updater.add_artifact(
                [], artifact_id=artifact_id, append=True, last_chunk=True
            )
            await updater.complete()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.exception("A2A %s task %s failed", self.role, task_id)
            await updater.failed(
                updater.new_agent_message(
                    [
                        Part(
                            text=f"The {self.role} could not generate a result ({type(error).__name__})."
                        )
                    ]
                )
            )
        finally:
            self.active_task_ids.discard(task_id)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        if not context.task_id or not context.context_id:
            raise ValueError("Cancellation requires task and context IDs")

        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.cancel()
        # The SDK cancel path waits for its consumer to finish before it writes
        # the final snapshot. Closing the producer queue releases that waiter.
        await cast(EventQueueSource, event_queue).close()

    async def _stream_text(self, prompt: str) -> AsyncGenerator[str, None]:
        if self.mode == "scripted":
            async for text in self._scripted_text(prompt):
                yield text

            return

        model = create_chat_model(
            load_model_config().a2a_model,
            max_tokens=2200,
            # The demo budgets visible answers; reasoning can otherwise consume
            # that budget before any artifact text is produced.
            disable_thinking=True,
        )
        messages = [
            SystemMessage(content=SYSTEM_PROMPTS[self.role]),
            HumanMessage(content=prompt),
        ]
        buffer = ""
        last_emitted_at = time.monotonic()
        first_chunk = True

        model_stream = cast(
            AsyncGenerator[AIMessageChunk, None], model.astream(messages)
        )

        async with aclosing(model_stream) as chunks:
            async for chunk in chunks:
                buffer += str(chunk.text)

                if not buffer:
                    continue

                should_emit = (
                    first_chunk
                    or time.monotonic() - last_emitted_at >= 0.15
                    or len(buffer) >= 600
                )

                if should_emit:
                    yield buffer
                    buffer = ""
                    first_chunk = False
                    last_emitted_at = time.monotonic()

        if buffer:
            yield buffer

    async def _scripted_text(self, prompt: str) -> AsyncGenerator[str, None]:
        request_summary = " ".join(prompt.split())[:900]

        if self.role == "planner":
            _, feedback_marker, feedback = prompt.partition("\nReviewer feedback:\n")
            stage_revision = prompt.startswith("Stage: Revise\n") and bool(
                feedback_marker and feedback.strip()
            )
            # Persisted requests retain the coordinator's pre-stage envelope.
            _, legacy_review_marker, legacy_review = prompt.partition(
                "\nRevise it using this review:\n"
            )
            legacy_revision = prompt.startswith("Original proposal:\n") and bool(
                legacy_review_marker and legacy_review.strip()
            )
            revision = stage_revision or legacy_revision
            heading = "Revised plan" if revision else "Practical plan"
            paragraphs = [
                f"## {heading}\n\nRequest: {request_summary}\n\n",
                "1. Objective and audience: confirm the desired outcome and adapt the scope to the named participants.\n\n",
                "2. Preparation: the coordinator gathers participant needs, assigns an owner to each activity, and publishes a short agenda before the event.\n\n",
                "3. Delivery: begin with a 10-minute introduction, run a 30-minute guided exercise, and close with a 15-minute discussion and agreed next steps.\n\n",
                "4. Ownership and timing: one facilitator owns delivery; the coordinator checks readiness two days beforehand and follows up the next day.\n\n",
                "5. Risks: prepare a smaller fallback exercise for time pressure, a written guide for absences, and a backup facilitator.\n\n",
                "6. Success criteria: collect one completed exercise per participant, an anonymous usefulness rating, and a named owner and deadline for each follow-up.\n\n",
                "Revision notes: made audience, ownership, timing, fallback arrangements, and measurable outcomes explicit in response to the Reviewer feedback.\n"
                if revision
                else "Handoff: the initial draft is ready for the independent Reviewer.\n",
            ]
        else:
            paragraphs = [
                f"## Independent review\n\nReviewed input: {request_summary}\n\n",
                "Assessment: the plan provides a workable starting point and needs clear operational commitments.\n\n",
                "1. Audience fit: state the participants' experience level and adapt the exercise to their actual needs.\n\n",
                "2. Ownership: name the facilitator and coordinator and assign every follow-up to one owner.\n\n",
                "3. Timing: confirm the preparation deadline and reserve time for questions and the final discussion.\n\n",
                "4. Risks: include a fallback for low attendance, limited time, and facilitator absence.\n\n",
                "5. Evidence of success: define the completed exercise, participant feedback, and dated follow-up commitments.\n\n",
                "Recommendation: revise the full plan with these details before sharing it with participants.\n",
            ]

        for paragraph in paragraphs:
            await asyncio.sleep(self.chunk_delay)
            yield paragraph
