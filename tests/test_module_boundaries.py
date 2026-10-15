"""Keep capability ownership and application entry wiring explicit."""

import ast
import json
from graphlib import TopologicalSorter
from importlib.util import resolve_name
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = PROJECT_ROOT / "agent_playground"

# These are ownership boundaries, not a list of current module implementations.
ALLOWED_IMPORTS = {
    "config": ("config", "models.profiles"),
    "context": ("context_state", "models.tokens", "planning"),
    "context_state": (),
    "graph": (
        "config",
        "context",
        "db",
        "knowledge",
        "interactions",
        "memory",
        "models",
        "observability",
        "planning",
        "prompts",
        "skills",
        "workflows",
    ),
    "db": ("config", "services.a2a.contracts", "db"),
    "knowledge": ("config", "db", "knowledge"),
    "interactions": ("config",),
    "memory": ("config", "context_state", "models.tokens", "memory"),
    "models": ("config", "models"),
    "observability": ("observability",),
    "planning": ("models.tokens",),
    "prompts": (),
    "services": ("config", "db", "models", "services"),
    "services.a2a.contracts": (),
    "skills": ("config", "skills"),
    "workflows": (
        "config",
        "db",
        "models",
        "services",
        "workflows",
    ),
}


def application_modules() -> dict[str, Path]:
    modules: dict[str, Path] = {}

    for path in PACKAGE_ROOT.rglob("*.py"):
        parts = list(path.relative_to(PROJECT_ROOT).with_suffix("").parts)

        if parts[-1] == "__init__":
            parts.pop()

        modules[".".join(parts)] = path

    return modules


def imported_modules(module: str, path: Path) -> set[str]:
    imports: set[str] = set()
    package = module if path.name == "__init__.py" else module.rpartition(".")[0]

    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            owner = node.module or ""

            if node.level:
                owner = resolve_name("." * node.level + owner, package)

            imports.add(owner)

            # Importing a module from a package must not bypass boundary checks.
            initializer = PROJECT_ROOT.joinpath(*owner.split("."), "__init__.py")

            if initializer.is_file():
                imports.update(f"{owner}.{alias.name}" for alias in node.names)

    return {name for name in imports if name.startswith("agent_playground.")}


def test_capability_imports_respect_ownership():
    violations: list[str] = []
    # A pure contract module has stricter rules than its containing capability.
    boundaries = sorted(ALLOWED_IMPORTS, key=len, reverse=True)

    for module, path in application_modules().items():
        owner = module.removeprefix("agent_playground.")
        boundary = next(
            (
                prefix
                for prefix in boundaries
                if owner == prefix or owner.startswith(prefix + ".")
            ),
            None,
        )

        if boundary is None:
            continue

        allowed = ALLOWED_IMPORTS[boundary]

        for dependency in imported_modules(module, path):
            target = dependency.removeprefix("agent_playground.")
            permitted = any(
                target == prefix or target.startswith(prefix + ".")
                for prefix in allowed
            )

            if not permitted:
                violations.append(f"{module} imports {dependency}")

    assert not violations, "\n".join(violations)


def test_application_imports_resolve_without_cycles():
    modules = application_modules()
    dependencies = {
        module: imported_modules(module, path) for module, path in modules.items()
    }
    missing = {
        dependency
        for imports in dependencies.values()
        for dependency in imports
        if dependency not in modules
    }

    assert not missing, f"Missing application modules: {sorted(missing)}"
    tuple(TopologicalSorter(dependencies).static_order())


def test_package_initializers_do_not_construct_or_reexport_capabilities():
    for path in PACKAGE_ROOT.rglob("__init__.py"):
        statements = ast.parse(path.read_text(encoding="utf-8")).body
        only_documentation = all(
            isinstance(statement, ast.Expr)
            and isinstance(statement.value, ast.Constant)
            and isinstance(statement.value.value, str)
            for statement in statements
        )

        assert only_documentation, f"Keep {path.relative_to(PROJECT_ROOT)} lightweight"


def test_aegra_entries_resolve_to_real_application_definitions():
    configuration = json.loads((PROJECT_ROOT / "aegra.json").read_text("utf-8"))
    entries = [*configuration["graphs"].values(), configuration["http"]["app"]]

    for entry in entries:
        filename, separator, name = entry.partition(":")
        assert separator and name
        path = (PROJECT_ROOT / filename).resolve()
        assert path.is_relative_to(PACKAGE_ROOT)
        nodes = ast.parse(path.read_text(encoding="utf-8")).body
        definitions = {
            node.name
            for node in nodes
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        definitions.update(
            target.id
            for node in nodes
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name)
        )

        assert name in definitions, f"Missing entry definition: {entry}"
