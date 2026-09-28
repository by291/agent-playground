"""Exercise persisted trace propagation through Aegra's real Redis worker."""

import json
import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import override
from uuid import uuid4

import httpx
import psycopg
import pytest
from opentelemetry import trace
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.proto.trace.v1.trace_pb2 import Span
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from testcontainers.community.postgres import PostgresContainer
from testcontainers.core.container import DockerContainer

ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))

        return listener.getsockname()[1]


@pytest.fixture
def worker(tmp_path: Path) -> Iterator[tuple[str, list[Span]]]:
    spans: list[Span] = []

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            request = ExportTraceServiceRequest()

            request.ParseFromString(
                self.rfile.read(int(self.headers["Content-Length"]))
            )

            for resource in request.resource_spans:
                for scope in resource.scope_spans:
                    spans.extend(scope.spans)

            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"")

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)

    Thread(target=receiver.serve_forever, daemon=True).start()
    config = tmp_path / "aegra.json"

    config.write_text(
        json.dumps({"graphs": {"agent": f"{ROOT}/tests/fixtures/trace_agent.py:graph"}})
    )
    log_path = tmp_path / "aegra.log"

    try:
        with (
            PostgresContainer(
                "postgres:18-alpine",
                username="agent",
                password="agent",
                dbname="agent_playground",
            ) as postgres,
            DockerContainer("redis:8-alpine").with_exposed_ports(6379) as redis,
            log_path.open("w") as log,
        ):
            database = postgres.get_connection_url().replace(
                "postgresql+psycopg2", "postgresql"
            )

            with psycopg.connect(database, autocommit=True) as connection:
                connection.execute(
                    (ROOT / "infra/postgres/init/01-schemas.sql").read_bytes()
                )

            agent_database = database.replace("agent:agent@", "aegra:aegra@")
            port = free_port()
            env = {
                **os.environ,
                "AEGRA_CONFIG": str(config),
                "DATABASE_URL": agent_database,
                "APP_DATABASE_URL": database,
                "REDIS_BROKER_ENABLED": "true",
                "REDIS_URL": f"redis://{redis.get_container_host_ip()}:{redis.get_exposed_port(6379)}/0",
                "OTEL_TARGETS": "GENERIC",
                "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{receiver.server_port}/v1/traces",
                "OTEL_BSP_SCHEDULE_DELAY": "100",
                "OTEL_BSP_EXPORT_TIMEOUT": "1000",
                "LOG_LEVEL": "WARNING",
            }
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "aegra_api.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=log,
            )
            url = f"http://127.0.0.1:{port}"

            try:
                deadline = time.monotonic() + 45

                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        pytest.fail(log_path.read_text()[-6000:])

                    try:
                        if httpx.get(f"{url}/health", timeout=1).is_success:
                            break
                    except httpx.HTTPError:
                        pass

                    time.sleep(0.1)
                else:
                    pytest.fail(log_path.read_text()[-6000:])

                yield url, spans
            finally:
                process.terminate()

                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    finally:
        receiver.shutdown()
        receiver.server_close()


def test_redis_worker_keeps_trace_after_browser_disconnect(
    worker: tuple[str, list[Span]],
):
    url, spans = worker
    provider = TracerProvider()
    parent = provider.get_tracer("test-browser").start_span("web.submit")
    carrier: dict[str, str] = {}

    TraceContextTextMapPropagator().inject(
        carrier, context=trace.set_span_in_context(parent)
    )
    expected_trace = parent.get_span_context().trace_id.to_bytes(16, "big")
    expected_parent = parent.get_span_context().span_id.to_bytes(8, "big")

    parent.end()
    thread_id = str(uuid4())
    agui_run_id = str(uuid4())

    with httpx.Client(timeout=15) as client:
        client.post(f"{url}/threads", json={"thread_id": thread_id}).raise_for_status()

        with client.stream(
            "POST",
            f"{url}/threads/{thread_id}/runs/stream",
            json={
                "assistant_id": "agent",
                "input": {"messages": [{"role": "user", "content": "Check the clock"}]},
                "config": {
                    "metadata": {
                        "agui_run_id": agui_run_id,
                        "otel_trace_context": carrier,
                    }
                },
                "metadata": {"agui_run_id": agui_run_id},
                "on_disconnect": "continue",
            },
        ) as response:
            response.raise_for_status()
            # Close the HTTP stream while the worker is still executing.
            next(response.iter_lines())

        deadline = time.monotonic() + 15

        while time.monotonic() < deadline:
            runs = client.get(f"{url}/threads/{thread_id}/runs").json()

            if (
                runs
                and runs[0]["status"] == "success"
                and any(span.name == "agent.execute" for span in spans)
            ):
                break

            time.sleep(0.1)
        else:
            pytest.fail("The disconnected run did not complete and export its trace")

    execution = next(span for span in spans if span.name == "agent.execute")

    assert execution.trace_id == expected_trace
    assert execution.parent_span_id == expected_parent
    assert len(spans) > 3
    assert all(span.trace_id == expected_trace for span in spans)
    assert any(span.name == "get_current_time" for span in spans)
    assert any("TraceModel" in span.name for span in spans)
    by_id = {span.span_id: span for span in spans}

    for span in spans:
        assert span.parent_span_id == expected_parent or span.parent_span_id in by_id

    provider.shutdown()
