"""A small local MCP server used by the playground agent."""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("agent-playground")


@mcp.tool()
def calculate_sum(left: float, right: float) -> float:
    """Add two numbers using the local MCP server."""
    return left + right


if __name__ == "__main__":
    mcp.run(transport="stdio")
