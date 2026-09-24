FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /uvx /bin/
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY aegra.json ./
COPY agent_playground ./agent_playground
ENV PATH="/app/.venv/bin:$PATH"
CMD ["aegra", "serve", "--host", "0.0.0.0", "--port", "2026"]
