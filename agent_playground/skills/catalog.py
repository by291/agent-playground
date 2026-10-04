"""Discover immutable Skill bundles without exposing the host filesystem."""

import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import yaml

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_BYTES = 32 * 1024


def relative_path(value: str) -> str:
    path = PurePosixPath(value)

    if not value or path.is_absolute() or ".." in path.parts or "\\" in value:
        raise ValueError("Use a relative published file path without traversal")

    return str(path)


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    files: dict[str, bytes]


class SkillCatalog:
    def __init__(self, root: Path):
        self.skills: dict[str, Skill] = {}

        if not root.exists():
            return

        for directory in sorted(root.iterdir()):
            if directory.is_symlink():
                raise ValueError("Skill directories must not be symlinks")

            if not directory.is_dir() or not (directory / "SKILL.md").exists():
                continue

            files: dict[str, bytes] = {}

            for path in sorted(directory.rglob("*")):
                if path.is_symlink():
                    raise ValueError(f"Skill {directory.name} contains a symlink")

                if path.is_file():
                    if path.stat().st_size > MAX_FILE_BYTES:
                        raise ValueError("Published Skill file exceeds 10 MiB")

                    files[path.relative_to(directory).as_posix()] = path.read_bytes()

            if len(files) > 200 or sum(map(len, files.values())) > MAX_FILE_BYTES:
                raise ValueError("Skill bundle exceeds 200 files or 10 MiB")

            document = files["SKILL.md"].decode("utf-8")
            parts = re.split(r"(?m)^---[ \t]*\r?$", document, maxsplit=2)

            if len(parts) != 3 or parts[0].strip():
                raise ValueError("SKILL.md requires YAML frontmatter")

            metadata = yaml.safe_load(parts[1])

            if not isinstance(metadata, dict):
                raise TypeError("Skill metadata must contain name and description")

            name = metadata.get("name")
            description = metadata.get("description")

            if not isinstance(name, str) or not re.fullmatch(
                r"[a-z0-9]+(?:-[a-z0-9]+)*", name
            ):
                raise ValueError("Invalid Skill name")

            if name != directory.name:
                raise ValueError("Skill name must match its directory")

            if (
                not isinstance(description, str)
                or not description.strip()
                or len(description) > 1024
            ):
                raise ValueError("Skill description must contain 1 to 1024 characters")

            if len(files["SKILL.md"]) > MAX_TEXT_BYTES:
                raise ValueError("SKILL.md exceeds 32 KiB")

            self.skills[name] = Skill(name, description.strip(), files)

    def get(self, name: str) -> Skill:
        if name not in self.skills:
            raise ValueError(f"Unknown Skill: {name}")

        return self.skills[name]

    def read(self, name: str, path: str) -> str:
        data = self.get(name).files.get(relative_path(path))

        if data is None:
            raise ValueError("File is not present in the published Skill")

        if len(data) > MAX_TEXT_BYTES:
            raise ValueError("Text resource exceeds 32 KiB; use it from a script")

        return data.decode("utf-8")

    def prompt(self) -> str:
        if not self.skills:
            return ""

        entries = "\n".join(
            f"- {skill.name}: {skill.description}" for skill in self.skills.values()
        )

        return (
            "\n\n## Agent Skills\n"
            "Select matching skills automatically, or follow an explicit $skill-name. "
            "Call load_skill to read its instructions before using it. "
            "Read supporting text with read_skill_file; run its published Python, Bash "
            "or Node scripts with run_skill_script. Reload instructions if compaction "
            "removed details you need. Scripts share /workspace only during this run. "
            "Use uploaded file IDs as input_files; they appear at /workspace/inputs/<id>/<name>. "
            "Declare output_files relative to /workspace to deliver downloads. "
            "Use arguments exactly as documented. Do not retry a failed or ambiguous "
            "external write without confirming its outcome. Base completion claims on "
            "exit status and results; never invent file links.\n" + entries
        )
