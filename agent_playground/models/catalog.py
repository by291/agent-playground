"""Server-owned chat model catalog and resolved request budgets."""

from dataclasses import dataclass
from typing import TypedDict

from langchain_core.language_models import BaseChatModel
from pydantic import SecretStr

from agent_playground.config.models import load_model_config
from agent_playground.models.profiles import (
    ChatProvider,
    ModelInformation,
    ThinkingLevel,
    model_information,
)
from agent_playground.models.providers import create_provider_model
from agent_playground.models.tokens import ContextSettings


class ModelOption(TypedDict):
    id: str
    label: str
    model: str
    available: bool


class AgentInfo(TypedDict):
    model: str
    defaultModelId: str
    models: list[ModelOption]


@dataclass(frozen=True)
class ChatModelConfiguration:
    id: str
    provider: ChatProvider
    label: str
    model: str
    api_key: SecretStr
    base_url: str | None
    information: ModelInformation
    input_override: int | None
    output_override: int | None
    thinking: ThinkingLevel
    compact_ratio: float

    @property
    def available(self) -> bool:
        return bool(self.api_key.get_secret_value().strip())

    def public_option(self) -> ModelOption:
        return {
            "id": self.id,
            "label": self.label,
            "model": self.model,
            "available": self.available,
        }

    def output_budget(self, thinking: ThinkingLevel, limit: int | None = None) -> int:
        """Apply an optional call limit within the configured provider budget."""
        budget = self.output_override or self.information.output_budget(thinking)

        if limit is not None:
            budget = min(budget, limit)

        return budget

    @property
    def max_output_tokens(self) -> int:
        return self.output_budget(self.thinking)

    @property
    def max_input_tokens(self) -> int:
        budget = self.information.input_limit(self.thinking)

        if self.input_override is not None:
            budget = min(budget, self.input_override)

        # Input and output share the provider's total context window.
        return min(budget, self.information.context_window - self.max_output_tokens)

    def context_settings(self, model: BaseChatModel) -> ContextSettings:
        return ContextSettings.from_model(
            model,
            window=self.max_input_tokens,
            compact_ratio=self.compact_ratio,
        )

    @property
    def image_tokens(self) -> int:
        return self.information.image_tokens


def model_configurations() -> tuple[ChatModelConfiguration, ...]:
    config = load_model_config()
    configurations: list[ChatModelConfiguration] = []

    for model_id, settings in config.chat.models.items():
        information = model_information(settings.provider, settings.model)
        configurations.append(
            ChatModelConfiguration(
                id=model_id,
                provider=settings.provider,
                label=settings.label or information.label,
                model=settings.model,
                api_key=settings.api_key,
                base_url=settings.base_url,
                information=information,
                input_override=settings.max_input_tokens,
                output_override=settings.max_output_tokens,
                thinking=settings.thinking,
                compact_ratio=config.chat.compact_ratio,
            )
        )

    return tuple(configurations)


def model_configuration(model_id: str | None = None) -> ChatModelConfiguration:
    """Resolve the persisted selection; an unknown ID never falls back to default."""
    selected = model_id if model_id is not None else load_model_config().chat.default

    for configuration in model_configurations():
        if configuration.id == selected:
            return configuration

    raise ValueError("Unknown chat model ID")


def agent_info() -> AgentInfo:
    """Expose model choices without credentials or provider client construction."""
    default = model_configuration()

    return {
        "model": default.model,
        "defaultModelId": default.id,
        "models": [
            configuration.public_option() for configuration in model_configurations()
        ],
    }


def create_chat_model(
    model_id: str | None = None,
    *,
    summary: bool = False,
    max_tokens: int | None = None,
    disable_thinking: bool = False,
) -> BaseChatModel:
    """Create an isolated provider client for a main, summary or revision call."""
    configuration = model_configuration(model_id)

    if not configuration.available:
        raise ValueError(f"Chat model {configuration.id} is not configured")

    requested_output = 4096 if summary else max_tokens

    if requested_output is not None and requested_output <= 0:
        raise ValueError("The output token budget must be positive")

    thinking = "disabled" if summary or disable_thinking else configuration.thinking

    return create_provider_model(
        configuration.provider,
        model=configuration.model,
        api_key=configuration.api_key,
        base_url=configuration.base_url,
        thinking=thinking,
        output_tokens=configuration.output_budget(thinking, requested_output),
    )
