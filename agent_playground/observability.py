"""Restore the server's persisted trace context around one graph execution."""

from collections.abc import Iterator
from contextlib import contextmanager

from langchain_core.runnables import RunnableConfig
from opentelemetry import context, trace
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from structlog.contextvars import bound_contextvars

_propagator = TraceContextTextMapPropagator()
_tracer = trace.get_tracer("agent-playground")


@contextmanager
def execution_trace(config: RunnableConfig) -> Iterator[None]:
    metadata = config.get("metadata", {})
    raw_carrier = metadata.get("otel_trace_context")
    carrier: dict[str, str] = (
        {key: value for key, value in raw_carrier.items() if isinstance(value, str)}
        if isinstance(raw_carrier, dict)
        else {}
    )
    parent = _propagator.extract(carrier, context=context.Context())
    token = context.attach(parent)

    try:
        configurable = config.get("configurable", {})
        attributes = {
            "langfuse.trace.name": "agent.submit",
            "langfuse.session.id": str(configurable.get("thread_id", "")),
            "langfuse.trace.metadata.agui_run_id": str(metadata.get("agui_run_id", "")),
            "langfuse.trace.metadata.aegra_run_id": str(configurable.get("run_id", "")),
        }

        with _tracer.start_as_current_span(
            "agent.execute", attributes=attributes
        ) as span:
            span_context = span.get_span_context()

            with bound_contextvars(
                trace_id=f"{span_context.trace_id:032x}",
                span_id=f"{span_context.span_id:016x}",
                agui_run_id=metadata.get("agui_run_id"),
            ):
                yield
    finally:
        # Aegra also calls the factory for inspection; never leave its parent active.
        context.detach(token)
