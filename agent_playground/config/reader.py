"""Common YAML parsing, validation and credential-safe configuration errors."""

from pathlib import Path
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, ValidationError

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class SettingsModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


def validate_url(value: str, schemes: tuple[str, ...]) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
        valid = (
            parsed.scheme in schemes
            and bool(parsed.hostname)
            and (port is None or port > 0)
        )
    except ValueError:
        valid = False

    if not valid:
        raise ValueError("Use an absolute URL with the supported scheme and host")

    return value.rstrip("/")


def load_yaml_settings[Settings: BaseModel](
    path: Path, schema: type[Settings]
) -> Settings:
    """Validate a private YAML file without exposing parser input in errors."""
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ValueError(
            f"Create {path.name} from {path.stem}.example.yaml or run make setup"
        ) from None

    try:
        document = yaml.safe_load(content)
    except yaml.YAMLError:
        # Parser errors can quote the line containing a credential.
        raise ValueError("Configuration is not valid YAML") from None

    try:
        return schema.model_validate(document)
    except ValidationError as error:
        issues = [
            f"{'.'.join(str(part) for part in issue['loc'])}: {issue['msg']}"
            for issue in error.errors(include_input=False, include_url=False)
        ]

        raise ValueError(f"Invalid configuration: {'; '.join(issues)}") from None
