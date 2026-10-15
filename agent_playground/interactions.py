"""Use native checkpointed human review for approvals and essential clarification."""

from collections.abc import Sequence
from copy import copy
from typing import Annotated, Any, NotRequired, Self, cast, override

from langchain.agents.middleware import AgentState, HumanInTheLoopMiddleware
from langchain.agents.middleware.human_in_the_loop import (
    Decision,
    InterruptOnConfig,
    _HumanInTheLoopState,
)
from langchain.agents.middleware.types import PrivateStateAttr, ToolCallRequest
from langchain_core.messages import ToolCall, ToolMessage
from langchain_core.tools import BaseTool, tool
from langgraph.runtime import Runtime
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)

from agent_playground.config.agent import ApprovalSettings

QuestionId = Annotated[
    str, StringConstraints(min_length=1, max_length=64, pattern=r"\S")
]
QuestionText = Annotated[
    str, StringConstraints(min_length=1, max_length=1000, pattern=r"\S")
]
OptionLabel = Annotated[
    str, StringConstraints(min_length=1, max_length=200, pattern=r"\S")
]
AnswerText = Annotated[
    str, StringConstraints(min_length=1, max_length=4000, pattern=r"\S")
]

_PROTECTED_TOOLS = {"run_skill_script", "remember_memory", "forget_memory"}
_RESERVED_TOOLS = {"ask_user", "write_todos"}
_SAFE_TOOLS = {
    "get_current_time",
    "search_knowledge",
    "search_memory",
    "list_skills",
    "load_skill",
    "read_skill_file",
    # Business workflows already own their review and external-wait contracts.
    "run_experiment_workflow",
    "run_sql_workflow",
    "run_report_workflow",
    "run_a2a_workflow",
}


class InteractionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class QuestionOption(InteractionInput):
    label: OptionLabel
    description: str = Field(default="", max_length=500)


class UserQuestion(InteractionInput):
    id: QuestionId
    question: QuestionText
    # An omitted list means free text. Explicit lists must offer 2-4 choices.
    options: list[QuestionOption] = Field(
        default_factory=list, min_length=2, max_length=4
    )

    @model_validator(mode="after")
    def unique_labels(self) -> Self:
        labels = [option.label for option in self.options]

        if len(set(labels)) != len(labels):
            raise ValueError("Question option labels must be unique")

        return self


class AskUserInput(InteractionInput):
    questions: list[UserQuestion] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        identifiers = [question.id for question in self.questions]

        if len(set(identifiers)) != len(identifiers):
            raise ValueError("Question IDs must be unique")

        return self


class UserAnswer(InteractionInput):
    id: QuestionId
    answer: AnswerText


class UserAnswers(InteractionInput):
    answers: list[UserAnswer] = Field(min_length=1, max_length=3)


class InteractionState(_HumanInTheLoopState[Any]):
    """Keep the policy for a model's pending calls stable across approval replay."""

    approval_policy: NotRequired[Annotated[dict[str, str], PrivateStateAttr]]


@tool(args_schema=AskUserInput)
def ask_user(questions: list[UserQuestion]) -> str:
    """Ask 1-3 questions when essential information is missing before continuing.

    Give every question a unique ID. Optional choices help the user answer, but
    the user may always write a different answer. Do not invent the user's input.
    """
    # Valid requests are answered by HITL's native respond decision, never execution.
    raise RuntimeError("ask_user requires a checkpointed human response")


def _valid_questions(request: ToolCallRequest) -> bool:
    try:
        AskUserInput.model_validate(request.tool_call["args"])
    except ValidationError:
        # Leave malformed calls to the real tool validator so the model can correct them.
        return False

    return True


def _approval_required(
    tool: BaseTool, settings: ApprovalSettings, is_mcp: bool
) -> bool:
    if tool.name in _RESERVED_TOOLS:
        return False

    if settings.mode == "all":
        return True

    configured = settings.tools.get(tool.name)

    if configured is not None:
        return configured

    if settings.mode == "configured":
        return False

    if tool.name in _PROTECTED_TOOLS:
        return True

    if is_mcp:
        annotations = tool.metadata or {}

        # Destructive annotations take priority even if a server also claims read-only.
        if annotations.get("destructiveHint") is True:
            return True

        return annotations.get("readOnlyHint") is not True

    return tool.name not in _SAFE_TOOLS


class InteractionMiddleware(HumanInTheLoopMiddleware):
    """Keep native interrupt/resume ownership while validating clarification answers."""

    state_schema = InteractionState

    def __init__(
        self,
        tools: Sequence[BaseTool],
        mcp_tools: Sequence[BaseTool],
        settings: ApprovalSettings,
    ) -> None:
        for discovered_tool in mcp_tools:
            if discovered_tool.name in _RESERVED_TOOLS:
                raise ValueError(f"MCP tool name {discovered_tool.name!r} is reserved")

        mcp_tool_ids = {id(tool) for tool in mcp_tools}
        approval_policy: dict[str, str] = {}
        interrupt_on: dict[str, bool | InterruptOnConfig] = {
            "ask_user": {
                "allowed_decisions": ["respond", "reject"],
                "description": "Provide the missing information so the agent can continue.",
                "when": _valid_questions,
            }
        }

        for exposed_tool in tools:
            if not _approval_required(
                exposed_tool, settings, id(exposed_tool) in mcp_tool_ids
            ):
                continue

            description = (
                exposed_tool.description[:1000]
                or "Review this operation before it runs."
            )
            approval_policy[exposed_tool.name] = description
            interrupt_on[exposed_tool.name] = {
                "allowed_decisions": ["approve", "reject"],
                "description": description,
            }

        super().__init__(interrupt_on=interrupt_on)
        self._approval_policy = approval_policy

    @override
    def before_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        # This checkpoint precedes the model's calls. Resuming after_model skips
        # before_model, so a restart cannot retarget positional human decisions.
        return {"approval_policy": dict(self._approval_policy)}

    @override
    def after_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any] | None:
        approval_policy = cast("InteractionState", state).get("approval_policy")

        if approval_policy is None:
            # Pre-feature checkpoints have no saved policy; their first boundary
            # uses current settings. Newly requested calls always carry a snapshot.
            approval_policy = self._approval_policy

        # A cached middleware serves concurrent threads. Adapt a local copy rather
        # than replacing its shared config while another review is being replayed.
        reviewer = copy(self)
        reviewer.interrupt_on = {
            name: InterruptOnConfig(
                allowed_decisions=["approve", "reject"], description=description
            )
            for name, description in approval_policy.items()
        }
        reviewer.interrupt_on["ask_user"] = self.interrupt_on["ask_user"]

        return HumanInTheLoopMiddleware.after_model(reviewer, state, runtime)

    @staticmethod
    @override
    def _process_decision(
        decision: Decision,
        tool_call: ToolCall,
        config: InterruptOnConfig,
    ) -> tuple[ToolCall | None, ToolMessage | None]:
        if tool_call["name"] == "ask_user" and decision["type"] == "respond":
            try:
                questions = AskUserInput.model_validate(tool_call["args"]).questions
                answers = UserAnswers.model_validate_json(decision["message"]).answers
            except ValidationError:
                raise ValueError("Invalid clarification answers") from None

            if [answer.id for answer in answers] != [
                question.id for question in questions
            ]:
                raise ValueError(
                    "Clarification answers must match question IDs in order"
                )

        return HumanInTheLoopMiddleware._process_decision(decision, tool_call, config)
