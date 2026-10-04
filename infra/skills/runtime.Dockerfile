FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash nodejs ca-certificates coreutils \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir \
    'httpx>=0.28,<0.29' 'pandas>=2,<4' 'openpyxl>=3.1,<4' 'pypdf>=6,<7'
RUN useradd --uid 1000 --create-home skill && mkdir /workspace /skills \
    && chown skill:skill /workspace
WORKDIR /workspace
