"""Short local command for serving the agent through Aegra."""

from aegra_cli.cli import cli


def main() -> None:
    cli.main(args=["serve"])
