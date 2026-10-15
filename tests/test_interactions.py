"""Exercise native approval and clarification boundaries across checkpoint resumes."""

import asyncio
import json
from typing import Any, Literal

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import StructuredTool, tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from agent_playground.config.agent import ApprovalSettings, load_agent_config
from agent_playground.graph import make_graph
from agent_playground.interactions import AskUserInput
from tests.agent_config import update_agent_config
from tests.test_context import RecordingModel


def invoke(graph: Any, inputs: Any, config: dict[str, Any], asynchronous: bool):
    if asynchronous:
        return asyncio.run(graph.ainvoke(inputs, config))

    return graph.invoke(inputs, config)


def tool_call(name: str, args: dict[str, Any], call_id: str = "action") -> AIMessage:
    return AIMessage(
        content="", tool_calls=[{"id": call_id, "name": name, "args": args}]
    )


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("decision", ["approve", "reject"])
def test_protected_tools_execute_only_after_approval_across_graph_recreation(
    asynchronous: bool, decision: str
):
    effects: list[str] = []

    @tool
    def record_effect(value: str) -> str:
        """Record a controlled side effect for the approval test."""
        effects.append(value)

        return f"Recorded {value}"

    settings = ApprovalSettings(mode="configured", tools={"record_effect": True})
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "approval"}}
    graph = make_graph(
        model=RecordingModel(responses=[tool_call("record_effect", {"value": "once"})]),
        checkpointer=saver,
        mcp_tools=[record_effect],
        approval_settings=settings,
    )

    paused = invoke(
        graph,
        {"messages": [HumanMessage(content="Record a value.")]},
        config,
        asynchronous,
    )

    assert effects == []
    request = paused["__interrupt__"][0].value
    assert request["action_requests"][0]["name"] == "record_effect"
    assert request["review_configs"][0]["allowed_decisions"] == ["approve", "reject"]
    model = RecordingModel(responses=[AIMessage(content="The decision was handled.")])
    recreated = make_graph(
        model=model,
        checkpointer=saver,
        mcp_tools=[record_effect],
        approval_settings=settings,
    )

    result = invoke(
        recreated,
        Command(resume={"decisions": [{"type": decision}]}),
        config,
        asynchronous,
    )

    assert effects == (["once"] if decision == "approve" else [])
    tool_result = next(
        message
        for message in model._inputs[-1]
        if isinstance(message, ToolMessage) and message.tool_call_id == "action"
    )
    assert tool_result.status == ("success" if decision == "approve" else "error")
    assert not result.get("__interrupt__")


@pytest.mark.parametrize("asynchronous", [False, True])
def test_user_answers_reach_the_model_after_checkpoint_resume(asynchronous: bool):
    questions = [
        {
            "id": "source",
            "question": "Which source should I inspect?",
            "options": [{"label": "Logs"}, {"label": "Metrics"}],
        },
        {"id": "period", "question": "Which period matters?"},
    ]
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "clarification"}}
    first = make_graph(
        model=RecordingModel(
            responses=[tool_call("ask_user", {"questions": questions})]
        ),
        checkpointer=saver,
    )

    paused = invoke(
        first,
        {"messages": [HumanMessage(content="Investigate the issue.")]},
        config,
        asynchronous,
    )

    request = paused["__interrupt__"][0].value
    assert request["action_requests"][0]["args"] == {"questions": questions}
    assert request["review_configs"][0]["allowed_decisions"] == ["respond", "reject"]
    answer = json.dumps(
        {
            "answers": [
                {"id": "source", "answer": "A custom trace"},
                {"id": "period", "answer": "Yesterday"},
            ]
        }
    )
    model = RecordingModel(responses=[AIMessage(content="I will inspect that trace.")])
    recreated = make_graph(model=model, checkpointer=saver)

    result = invoke(
        recreated,
        Command(resume={"decisions": [{"type": "respond", "message": answer}]}),
        config,
        asynchronous,
    )

    response = next(
        message
        for message in model._inputs[-1]
        if isinstance(message, ToolMessage) and message.tool_call_id == "action"
    )
    assert response.status == "success"
    assert isinstance(response.content, str)
    assert json.loads(response.content) == json.loads(answer)
    assert result["messages"][-1].content == "I will inspect that trace."


@pytest.mark.parametrize(
    "answers",
    [
        "not json",
        '{"answers":[]}',
        '{"answers":[{"id":"wrong","answer":"Something"}]}',
        '{"answers":[{"id":"first","answer":" "}]}',
        json.dumps({"answers": [{"id": "first", "answer": "x" * 4001}]}),
        '{"answers":[{"id":"first","answer":42}]}',
        '{"answers":[{"id":"first","answer":"Valid","extra":true}]}',
    ],
)
def test_invalid_native_answers_cannot_release_parallel_side_effects(answers: str):
    effects: list[str] = []

    @tool
    def record_effect() -> str:
        """Record the operation only after every native decision validates."""
        effects.append("executed")

        return "Recorded"

    response = AIMessage(
        content="",
        tool_calls=[
            {"id": "protected", "name": "record_effect", "args": {}},
            {
                "id": "question",
                "name": "ask_user",
                "args": {"questions": [{"id": "first", "question": "Which source?"}]},
            },
        ],
    )
    graph = make_graph(
        model=RecordingModel(responses=[response]),
        checkpointer=InMemorySaver(),
        mcp_tools=[record_effect],
    )
    config = {"configurable": {"thread_id": "invalid-answer"}}
    paused = graph.invoke({"messages": [HumanMessage(content="Investigate.")]}, config)
    assert paused["__interrupt__"]

    with pytest.raises(ValueError):
        graph.invoke(
            Command(
                resume={
                    "decisions": [
                        {"type": "approve"},
                        {"type": "respond", "message": answers},
                    ]
                }
            ),
            config,
        )

    assert effects == []


@pytest.mark.parametrize(
    "questions",
    [
        [],
        [{"id": "same", "question": "One?"}, {"id": "same", "question": "Two?"}],
        [{"id": " ", "question": "Which source?"}],
        [{"id": "source", "question": " "}],
        [
            {
                "id": "source",
                "question": "Which source?",
                "options": [{"label": "Only one"}],
            }
        ],
        [
            {
                "id": "source",
                "question": "Which source?",
                "options": [{"label": "Same"}, {"label": "Same"}],
            }
        ],
    ],
)
def test_invalid_question_arguments_reach_tool_validation_without_interrupting(
    questions: list[dict[str, Any]],
):
    model = RecordingModel(
        responses=[
            tool_call("ask_user", {"questions": questions}),
            AIMessage(content="I need to correct the question."),
        ]
    )
    graph = make_graph(model=model, checkpointer=InMemorySaver())

    result = graph.invoke(
        {"messages": [HumanMessage(content="Investigate.")]},
        {"configurable": {"thread_id": "invalid-question"}},
    )

    assert not result.get("__interrupt__")
    result_message = next(
        message for message in model._inputs[-1] if isinstance(message, ToolMessage)
    )
    assert result_message.status == "error"


@pytest.mark.parametrize(
    ("name", "metadata", "mode", "configured", "expected"),
    [
        ("remember_memory", None, "side_effects", {}, True),
        ("forget_memory", None, "side_effects", {}, True),
        ("run_skill_script", None, "side_effects", {}, True),
        ("get_current_time", None, "side_effects", {}, False),
        ("run_sql_workflow", None, "side_effects", {}, False),
        ("run_sql_workflow", None, "side_effects", {"run_sql_workflow": True}, True),
        ("external_lookup", {"readOnlyHint": True}, "side_effects", {}, False),
        (
            "external_delete",
            {"readOnlyHint": True, "destructiveHint": True},
            "side_effects",
            {},
            True,
        ),
        ("external_unknown", None, "side_effects", {}, True),
        ("external_unknown", None, "side_effects", {"external_unknown": False}, False),
        ("external_lookup", {"readOnlyHint": True}, "all", {}, True),
        (
            "external_lookup",
            {"readOnlyHint": True},
            "all",
            {"external_lookup": False},
            True,
        ),
        ("remember_memory", None, "configured", {}, False),
        ("external_unknown", None, "configured", {"external_unknown": True}, True),
        ("write_todos", None, "all", {"write_todos": True}, False),
    ],
)
def test_approval_policy_gates_exposed_tools(
    name: str,
    metadata: dict[str, Any] | None,
    mode: Literal["side_effects", "all", "configured"],
    configured: dict[str, bool],
    expected: bool,
):
    from agent_playground.interactions import InteractionMiddleware

    effects: list[str] = []

    def operation() -> str:
        effects.append(name)

        return "Done"

    exposed = StructuredTool.from_function(
        operation,
        name=name,
        description="Perform the controlled operation.",
        metadata=metadata,
    )
    middleware = InteractionMiddleware(
        [exposed],
        [exposed] if name.startswith("external_") else [],
        ApprovalSettings(mode=mode, tools=configured),
    )
    from langchain.agents import create_agent

    graph = create_agent(
        RecordingModel(responses=[tool_call(name, {}), AIMessage(content="Done.")]),
        tools=[exposed],
        middleware=[middleware],
        checkpointer=InMemorySaver(),
    )

    result = graph.invoke(
        {"messages": [HumanMessage(content="Execute the operation.")]},
        {"configurable": {"thread_id": "policy"}},
    )

    assert bool(result.get("__interrupt__")) is expected
    assert effects == ([] if expected else [name])


def test_approval_settings_load_from_the_owned_runtime_configuration():
    update_agent_config("approvals", mode="configured", tools={"remember_memory": True})

    settings = load_agent_config().approvals

    assert settings.mode == "configured"
    assert settings.tools == {"remember_memory": True}


def test_each_protected_operation_requires_its_own_approval():
    effects: list[str] = []

    @tool
    def record_effect(value: str) -> str:
        """Record a value after the user authorizes this specific operation."""
        effects.append(value)

        return value

    model = RecordingModel(
        responses=[
            tool_call("record_effect", {"value": "first"}, "first"),
            tool_call("record_effect", {"value": "second"}, "second"),
            AIMessage(content="Both operations completed."),
        ]
    )
    graph = make_graph(
        model=model,
        checkpointer=InMemorySaver(),
        mcp_tools=[record_effect],
    )
    config = {"configurable": {"thread_id": "per-operation"}}
    graph.invoke({"messages": [HumanMessage(content="Record two values.")]}, config)

    paused_again = graph.invoke(
        Command(resume={"decisions": [{"type": "approve"}]}), config
    )

    assert effects == ["first"]
    assert paused_again["__interrupt__"][0].value["action_requests"][0]["args"] == {
        "value": "second"
    }

    graph.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)

    assert effects == ["first", "second"]


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("replacement_policy", [{"new_operation": True}, {}])
def test_pending_decisions_remain_bound_to_the_original_policy_after_recreation(
    asynchronous: bool, replacement_policy: dict[str, bool]
):
    effects: list[str] = []

    @tool
    def old_operation() -> str:
        """Perform the operation originally presented for approval."""
        effects.append("old")

        return "Old operation executed"

    @tool
    def new_operation() -> str:
        """Perform the operation originally exempt from approval."""
        effects.append("new")

        return "New operation executed"

    initial_call = AIMessage(
        content="",
        tool_calls=[
            {"id": "old-call", "name": "old_operation", "args": {}},
            {"id": "new-call", "name": "new_operation", "args": {}},
        ],
    )
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "policy-replay"}}
    first = make_graph(
        model=RecordingModel(responses=[initial_call]),
        checkpointer=saver,
        mcp_tools=[old_operation, new_operation],
        approval_settings=ApprovalSettings(
            mode="configured", tools={"old_operation": True}
        ),
    )
    paused = invoke(
        first,
        {"messages": [HumanMessage(content="Perform both operations.")]},
        config,
        asynchronous,
    )

    assert effects == []
    request = paused["__interrupt__"][0].value
    assert [action["name"] for action in request["action_requests"]] == [
        "old_operation"
    ]
    model = RecordingModel(
        responses=[AIMessage(content="The original decision was respected.")]
    )
    recreated = make_graph(
        model=model,
        checkpointer=saver,
        mcp_tools=[old_operation, new_operation],
        approval_settings=ApprovalSettings(mode="configured", tools=replacement_policy),
    )

    invoke(
        recreated,
        Command(resume={"decisions": [{"type": "reject"}]}),
        config,
        asynchronous,
    )

    assert effects == ["new"]
    results = {
        message.tool_call_id: message
        for message in model._inputs[-1]
        if isinstance(message, ToolMessage)
    }
    assert results["old-call"].status == "error"
    assert results["new-call"].status == "success"


@pytest.mark.parametrize("asynchronous", [False, True])
def test_recreated_policy_applies_at_the_next_model_boundary(asynchronous: bool):
    effects: list[str] = []

    @tool
    def record_effect(value: str) -> str:
        """Record an operation under the policy that existed when it was requested."""
        effects.append(value)

        return value

    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "policy-refresh"}}
    first = make_graph(
        model=RecordingModel(
            responses=[tool_call("record_effect", {"value": "first"}, "first")]
        ),
        checkpointer=saver,
        mcp_tools=[record_effect],
        approval_settings=ApprovalSettings(
            mode="configured", tools={"record_effect": True}
        ),
    )
    invoke(
        first,
        {"messages": [HumanMessage(content="Record two values.")]},
        config,
        asynchronous,
    )
    recreated = make_graph(
        model=RecordingModel(
            responses=[
                tool_call("record_effect", {"value": "second"}, "second"),
                AIMessage(content="Done."),
            ]
        ),
        checkpointer=saver,
        mcp_tools=[record_effect],
        approval_settings=ApprovalSettings(mode="configured"),
    )

    result = invoke(
        recreated,
        Command(resume={"decisions": [{"type": "reject"}]}),
        config,
        asynchronous,
    )

    assert effects == ["second"]
    assert not result.get("__interrupt__")


@pytest.mark.parametrize("asynchronous", [False, True])
def test_newly_protected_calls_require_fresh_approval_at_the_next_model_boundary(
    asynchronous: bool,
):
    effects: list[str] = []

    @tool
    def record_effect() -> str:
        """Perform the next operation after its newly required approval."""
        effects.append("executed")

        return "Done"

    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "new-policy-gate"}}
    first = make_graph(
        model=RecordingModel(responses=[tool_call("get_current_time", {}, "clock")]),
        checkpointer=saver,
        mcp_tools=[record_effect],
        approval_settings=ApprovalSettings(
            mode="configured", tools={"get_current_time": True}
        ),
    )
    invoke(
        first,
        {"messages": [HumanMessage(content="Check the time and record it.")]},
        config,
        asynchronous,
    )
    recreated = make_graph(
        model=RecordingModel(
            responses=[
                tool_call("record_effect", {}, "write"),
                AIMessage(content="Recorded."),
            ]
        ),
        checkpointer=saver,
        mcp_tools=[record_effect],
        approval_settings=ApprovalSettings(
            mode="configured", tools={"record_effect": True}
        ),
    )

    paused_again = invoke(
        recreated,
        Command(resume={"decisions": [{"type": "approve"}]}),
        config,
        asynchronous,
    )

    assert effects == []
    actions = paused_again["__interrupt__"][0].value["action_requests"]
    assert [action["name"] for action in actions] == ["record_effect"]

    invoke(
        recreated,
        Command(resume={"decisions": [{"type": "approve"}]}),
        config,
        asynchronous,
    )

    assert effects == ["executed"]


def test_clients_cannot_override_or_read_the_private_approval_policy():
    effects: list[str] = []

    @tool
    def record_effect() -> str:
        """Perform an operation only after its private policy requires approval."""
        effects.append("executed")

        return "Done"

    graph = make_graph(
        model=RecordingModel(responses=[tool_call("record_effect", {})]),
        checkpointer=InMemorySaver(),
        mcp_tools=[record_effect],
    )

    paused = graph.invoke(
        {"messages": [HumanMessage(content="Record a value.")], "approval_policy": {}},
        {"configurable": {"thread_id": "private-policy"}},
    )

    assert paused["__interrupt__"]
    assert effects == []
    assert "approval_policy" not in paused
    schema = graph.get_input_schema().model_json_schema()
    input_schema = schema["$defs"][schema["$ref"].rsplit("/", 1)[-1]]
    assert "approval_policy" not in input_schema["properties"]


@pytest.mark.parametrize("name", ["ask_user", "write_todos"])
def test_mcp_tools_cannot_replace_reserved_interaction_tools(name: str):
    exposed = StructuredTool.from_function(
        lambda: "Unexpected execution", name=name, description="An external operation."
    )

    with pytest.raises(ValueError, match="reserved"):
        make_graph(
            model=RecordingModel(responses=[AIMessage(content="Done.")]),
            mcp_tools=[exposed],
        )


def test_clarification_answers_must_keep_the_requested_id_order():
    questions = [
        {"id": "source", "question": "Which source?"},
        {"id": "period", "question": "Which period?"},
    ]
    graph = make_graph(
        model=RecordingModel(
            responses=[tool_call("ask_user", {"questions": questions})]
        ),
        checkpointer=InMemorySaver(),
    )
    config = {"configurable": {"thread_id": "answer-order"}}
    graph.invoke({"messages": [HumanMessage(content="Investigate.")]}, config)
    answers = json.dumps(
        {
            "answers": [
                {"id": "period", "answer": "Yesterday"},
                {"id": "source", "answer": "Logs"},
            ]
        }
    )

    with pytest.raises(ValueError, match="IDs in order"):
        graph.invoke(
            Command(resume={"decisions": [{"type": "respond", "message": answers}]}),
            config,
        )


def test_question_ids_and_answer_choices_remain_literal_reference_data():
    arguments = {
        "questions": [
            {
                "id": "source",
                "question": "Which source?",
                "options": [{"label": "Logs"}, {"label": "Metrics"}],
            }
        ]
    }

    validated = AskUserInput.model_validate(arguments)

    assert validated.questions[0].id == "source"
    assert [option.label for option in validated.questions[0].options] == [
        "Logs",
        "Metrics",
    ]
