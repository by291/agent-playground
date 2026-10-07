"""Validate model budgets and the provider requests that consume them."""

import asyncio
import json
from typing import Any

import httpx2 as httpx
import pytest
from langchain_core.language_models.model_profile import ModelProfile
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_deepseek import ChatDeepSeek
from langchain_qwq import ChatQwen

from agent_playground.model_profiles import library_model_profile
from agent_playground.models import agent_info, create_chat_model, model_configuration
from tests.model_config import ModelConfigFile


@pytest.fixture
def provider_requests(monkeypatch: pytest.MonkeyPatch):
    requests: list[dict[str, Any]] = []

    def send(
        _client: httpx.Client | httpx.AsyncClient,
        request: httpx.Request,
        **_kwargs: Any,
    ):
        payload = json.loads(request.content)
        requests.append(payload)
        message = {
            "role": "assistant",
            "content": "",
            "reasoning_content": "The clock tool answers this request.",
            "tool_calls": [
                {
                    "id": "clock-call",
                    "type": "function",
                    "function": {"name": "clock", "arguments": "{}"},
                }
            ],
        }
        usage = {"prompt_tokens": 8, "completion_tokens": 12, "total_tokens": 20}
        completion = {
            "id": "completion-1",
            "object": "chat.completion",
            "created": 1,
            "model": payload["model"],
            "choices": [
                {"index": 0, "finish_reason": "tool_calls", "message": message}
            ],
            "usage": usage,
        }

        if payload.get("stream"):
            chunks: list[dict[str, Any]] = [
                {
                    **completion,
                    "object": "chat.completion.chunk",
                    "choices": [
                        {
                            "index": 0,
                            "finish_reason": None,
                            "delta": {
                                **message,
                                "tool_calls": [
                                    {"index": 0, **message["tool_calls"][0]}
                                ],
                            },
                        }
                    ],
                    "usage": None,
                },
                {
                    **completion,
                    "object": "chat.completion.chunk",
                    "choices": [
                        {"index": 0, "finish_reason": "tool_calls", "delta": {}}
                    ],
                },
            ]
            body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)

            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/event-stream"},
                content=body + "data: [DONE]\n\n",
            )

        return httpx.Response(200, request=request, json=completion)

    monkeypatch.setattr(httpx.Client, "send", send)

    async def async_send(
        client: httpx.AsyncClient, request: httpx.Request, **kwargs: Any
    ):
        return send(client, request, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "send", async_send)

    return requests


@pytest.mark.parametrize(
    ("model_id", "thinking", "limit_field"),
    [
        ("deepseek", "low", "max_tokens"),
        ("qwen", "low", "max_completion_tokens"),
    ],
)
@pytest.mark.parametrize("mode", ["sync", "async_stream"])
def test_thinking_tool_calls_preserve_reasoning_and_use_configured_output_limit(
    model_config: ModelConfigFile,
    provider_requests: list[dict[str, Any]],
    model_id: str,
    thinking: str,
    limit_field: str,
    mode: str,
):
    model_config.chat(
        model_id, api_key="test", max_output_tokens=12000, thinking=thinking
    )
    chat_model = create_chat_model(model_id)

    if mode == "async_stream":
        chat_model = chat_model.model_copy(update={"streaming": True})

    model = chat_model.bind_tools(
        [{"name": "clock", "description": "UTC time", "parameters": {"type": "object"}}]
    )
    question = HumanMessage(content="Check the time.")

    if mode == "async_stream":

        async def invoke():
            first = await model.ainvoke([question])
            await model.ainvoke(
                [
                    question,
                    first,
                    ToolMessage(content="12:00 UTC", tool_call_id="clock-call"),
                ]
            )

        asyncio.run(invoke())
    else:
        first = model.invoke([question])
        model.invoke(
            [
                question,
                first,
                ToolMessage(content="12:00 UTC", tool_call_id="clock-call"),
            ]
        )
    first_request, second_request = provider_requests
    assistant = next(
        message
        for message in second_request["messages"]
        if message["role"] == "assistant"
    )

    assert first_request[limit_field] == 12000
    assert assistant["reasoning_content"] == "The clock tool answers this request."

    if model_id == "deepseek":
        assert first_request["thinking"] == {"type": "enabled"}
        assert first_request["reasoning_effort"] == "low"
        assert "max_completion_tokens" not in first_request
    else:
        assert first_request["enable_thinking"] is True
        assert first_request["reasoning_effort"] == "low"
        assert "thinking_budget" not in first_request
        assert "max_tokens" not in first_request

    if mode == "async_stream":
        assert first_request["stream"] is True
        assert first_request["stream_options"] == {"include_usage": True}


@pytest.mark.parametrize("model_id", ["deepseek", "qwen"])
@pytest.mark.parametrize("enabled", [False, True])
def test_thinking_requests_accept_mixed_nonthinking_and_tool_history(
    model_config: ModelConfigFile,
    provider_requests: list[dict[str, Any]],
    model_id: str,
    enabled: bool,
):
    model_config.chat(
        model_id, api_key="test", thinking="medium" if enabled else "disabled"
    )
    legacy_reply = AIMessage(content="A previous nonthinking answer.")
    tool_reply = AIMessage(
        content="",
        additional_kwargs={"reasoning_content": "Use the clock."},
        tool_calls=[
            {"name": "clock", "args": {}, "id": "clock-call", "type": "tool_call"}
        ],
    )
    model = create_chat_model(model_id).bind_tools(
        [{"name": "clock", "description": "UTC time", "parameters": {"type": "object"}}]
    )
    model.invoke(
        [
            HumanMessage(content="An earlier question."),
            legacy_reply,
            HumanMessage(content="Check the time."),
            tool_reply,
            ToolMessage(content="12:00 UTC", tool_call_id="clock-call"),
        ]
    )
    assistants = [
        message
        for message in provider_requests[0]["messages"]
        if message["role"] == "assistant"
    ]

    assert assistants[1]["reasoning_content"] == "Use the clock."
    assert legacy_reply.additional_kwargs == {}

    if model_id == "deepseek" and enabled:
        assert assistants[0]["reasoning_content"] == ""
    else:
        assert "reasoning_content" not in assistants[0]


@pytest.mark.parametrize("model_id", ["deepseek", "qwen"])
@pytest.mark.parametrize("override", [None, 5000])
@pytest.mark.parametrize(
    ("options", "expected_limit"),
    [({"summary": True}, 4096), ({"max_tokens": 2200, "disable_thinking": True}, 2200)],
)
def test_internal_calls_disable_thinking_and_keep_their_output_budget(
    model_config: ModelConfigFile,
    provider_requests: list[dict[str, Any]],
    model_id: str,
    override: int | None,
    options: dict[str, Any],
    expected_limit: int,
):
    model_config.chat(model_id, api_key="test", thinking="medium")

    if override is None:
        model_config.settings["chat"]["models"][model_id].pop("max_output_tokens")
        model_config.save()
    else:
        model_config.chat(model_id, max_output_tokens=override)

    create_chat_model(model_id, **options).invoke("Return a concise answer.")
    payload = provider_requests[0]

    assert "reasoning_effort" not in payload
    assert "thinking_budget" not in payload

    if model_id == "deepseek":
        assert payload["thinking"] == {"type": "disabled"}
        assert payload["max_tokens"] == expected_limit
    else:
        assert payload["enable_thinking"] is False
        assert payload["max_completion_tokens"] == expected_limit


@pytest.mark.parametrize(
    ("enabled", "output_limit", "expected_input_budget"),
    [(False, 4096, 991808), (True, 4096, 983616), (True, 65536, 934464)],
)
def test_qwen_input_budget_accounts_for_thinking_mode_and_output_reservation(
    model_config: ModelConfigFile,
    enabled: bool,
    output_limit: int,
    expected_input_budget: int,
):
    model_config.chat(
        "qwen",
        api_key="test",
        max_output_tokens=output_limit,
        thinking="medium" if enabled else "disabled",
    )
    configuration = model_configuration("qwen")
    settings = configuration.context_settings(create_chat_model("qwen"))

    assert settings.window == expected_input_budget


def test_deepseek_input_budget_reserves_configured_output(
    model_config: ModelConfigFile,
):
    model_config.chat(max_output_tokens=65536)
    configuration = model_configuration("deepseek")

    assert configuration.context_settings(create_chat_model()).window == 934464


@pytest.mark.parametrize("model_id", ["deepseek", "qwen"])
def test_internal_output_budget_cannot_exceed_the_catalog_limit(
    model_config: ModelConfigFile,
    provider_requests: list[dict[str, Any]],
    model_id: str,
):
    model_config.chat(model_id, api_key="test", max_output_tokens=1000)
    create_chat_model(model_id, summary=True).invoke("Summarize.")
    field = "max_tokens" if model_id == "deepseek" else "max_completion_tokens"

    assert provider_requests[0][field] == 1000


@pytest.mark.parametrize(
    ("model_id", "changes"),
    [
        ("qwen", {"max_output_tokens": 0}),
        ("qwen", {"max_output_tokens": 131073}),
        ("deepseek", {"max_output_tokens": 393217}),
        ("qwen", {"max_input_tokens": 1000001}),
        ("deepseek", {"thinking": "xhigh"}),
        ("qwen", {"thinking": "max"}),
        ("deepseek", {"thinking": {"enabled": True}}),
        ("qwen", {"budget_tokens": 1000}),
    ],
)
def test_invalid_generation_settings_fail_without_leaking_keys(
    model_config: ModelConfigFile, model_id: str, changes: dict[str, Any]
):
    model_config.chat(model_id, api_key="never-expose-this-key", **changes)

    with pytest.raises(ValueError) as failure:
        agent_info()

    assert "never-expose-this-key" not in str(failure.value)


@pytest.mark.parametrize(
    ("model_id", "thinking", "output_budget", "input_budget", "native_effort"),
    [
        ("deepseek", "disabled", 8192, 991808, None),
        ("deepseek", "low", 65536, 934464, "low"),
        ("deepseek", "medium", 65536, 934464, "high"),
        ("deepseek", "high", 131072, 868928, "max"),
        ("qwen", "disabled", 131072, 868928, None),
        ("qwen", "low", 131072, 868928, "low"),
        ("qwen", "medium", 131072, 868928, "medium"),
        ("qwen", "high", 131072, 868928, "xhigh"),
    ],
)
def test_minimal_model_entries_resolve_defaults_and_native_thinking_levels(
    model_config: ModelConfigFile,
    provider_requests: list[dict[str, Any]],
    model_id: str,
    thinking: str,
    output_budget: int,
    input_budget: int,
    native_effort: str | None,
):
    entry = model_config.settings["chat"]["models"][model_id]
    model_config.settings["chat"]["models"][model_id] = {
        "provider": entry["provider"],
        "model": entry["model"],
        "api_key": "test",
        "thinking": thinking,
    }
    model_config.save()
    configuration = model_configuration(model_id)
    model = create_chat_model(model_id)
    model.invoke("Check the time.")
    request = provider_requests[0]
    limit_field = "max_tokens" if model_id == "deepseek" else "max_completion_tokens"

    assert request[limit_field] == output_budget
    assert request.get("reasoning_effort") == native_effort
    assert "thinking_budget" not in request
    assert configuration.context_settings(model).window == input_budget
    assert configuration.public_option()["label"] == (
        "DeepSeek" if model_id == "deepseek" else "Qwen"
    )


def test_omitted_thinking_explicitly_disables_provider_defaults(
    model_config: ModelConfigFile, provider_requests: list[dict[str, Any]]
):
    entry = model_config.settings["chat"]["models"]["deepseek"]
    entry.pop("thinking")
    entry.pop("max_output_tokens")
    model_config.save()
    create_chat_model().invoke("Answer briefly.")

    assert provider_requests[0]["thinking"] == {"type": "disabled"}
    assert provider_requests[0]["max_tokens"] == 8192


def test_verified_output_limit_overrides_the_stale_sdk_profile(
    model_config: ModelConfigFile, provider_requests: list[dict[str, Any]]
):
    model_config.chat(max_output_tokens=390000)
    create_chat_model().invoke("Answer briefly.")

    assert provider_requests[0]["max_tokens"] == 390000
    assert model_configuration().context_settings(create_chat_model()).window == 610000


def test_unknown_model_budgets_do_not_substitute_for_missing_capabilities(
    model_config: ModelConfigFile,
):
    model_config.chat(
        "qwen",
        model="unknown-model",
        api_key="never-expose-this-key",
        max_input_tokens=20000,
        max_output_tokens=1000,
    )

    with pytest.raises(ValueError, match="model information") as failure:
        agent_info()

    assert "never-expose-this-key" not in str(failure.value)


@pytest.mark.parametrize("model_name", ["gpt-4o", "gpt-5"])
def test_qwen_cannot_use_an_inherited_openai_model_profile(
    model_config: ModelConfigFile, model_name: str
):
    model_config.settings["chat"]["models"]["qwen"] = {
        "provider": "qwen",
        "model": model_name,
        "api_key": "never-expose-this-key",
    }
    model_config.save()

    with pytest.raises(ValueError, match="model information") as failure:
        agent_info()

    assert "never-expose-this-key" not in str(failure.value)


def test_sdk_profile_supports_a_model_without_a_verified_override(
    model_config: ModelConfigFile, provider_requests: list[dict[str, Any]]
):
    entry = model_config.settings["chat"]["models"]["deepseek"]
    entry.update(model="deepseek-v4-flash", thinking="disabled")
    entry.pop("max_output_tokens")
    model_config.save()
    create_chat_model().invoke("Answer briefly.")

    assert provider_requests[0]["model"] == "deepseek-v4-flash"
    assert provider_requests[0]["max_tokens"] > 0
    assert model_configuration().context_settings(create_chat_model()).window > 0


def test_model_metadata_does_not_initialize_provider_clients(
    monkeypatch: pytest.MonkeyPatch,
):
    def reject_initialization(*_args: Any, **_kwargs: Any):
        raise AssertionError("Metadata must not initialize a provider client")

    monkeypatch.setattr(ChatDeepSeek, "__init__", reject_initialization)
    monkeypatch.setattr(ChatQwen, "__init__", reject_initialization)

    assert (
        library_model_profile("deepseek", "deepseek-v4-flash")["max_input_tokens"] > 0
    )
    assert library_model_profile("qwen", "unknown-model") == {}


@pytest.mark.parametrize(
    "profile",
    [
        {"max_input_tokens": 64000},
        {"max_output_tokens": 8000},
        {"max_input_tokens": 0, "max_output_tokens": 8000},
        {"max_input_tokens": 64000, "max_output_tokens": 0},
    ],
)
def test_incomplete_sdk_capacities_fail_configuration_validation(
    model_config: ModelConfigFile,
    monkeypatch: pytest.MonkeyPatch,
    profile: ModelProfile,
):
    def sdk_profile(_provider: str, _model: str) -> ModelProfile:
        return profile

    monkeypatch.setattr(
        "agent_playground.model_profiles.library_model_profile",
        sdk_profile,
    )
    model_config.chat(model="unknown-model", api_key="never-expose-this-key")

    with pytest.raises(ValueError, match="model information") as failure:
        agent_info()

    assert "never-expose-this-key" not in str(failure.value)


def test_sdk_profile_without_effort_information_rejects_thinking(
    model_config: ModelConfigFile, monkeypatch: pytest.MonkeyPatch
):
    def sdk_profile(_provider: str, _model: str) -> ModelProfile:
        return {
            "max_input_tokens": 64000,
            "max_output_tokens": 8000,
            "reasoning_output": True,
        }

    monkeypatch.setattr(
        "agent_playground.model_profiles.library_model_profile",
        sdk_profile,
    )
    model_config.chat(model="unknown-model", thinking="medium")

    with pytest.raises(ValueError, match="thinking level"):
        agent_info()


def test_output_override_must_leave_space_in_the_total_context(
    model_config: ModelConfigFile, monkeypatch: pytest.MonkeyPatch
):
    def sdk_profile(_provider: str, _model: str) -> ModelProfile:
        return {"max_input_tokens": 8000, "max_output_tokens": 8000}

    monkeypatch.setattr(
        "agent_playground.model_profiles.library_model_profile",
        sdk_profile,
    )
    model_config.chat(
        model="unknown-model", thinking="disabled", max_output_tokens=8000
    )

    with pytest.raises(ValueError, match="leave room for input"):
        agent_info()
