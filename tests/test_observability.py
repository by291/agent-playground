"""Trace context must survive the queue without leaking across executions."""

import asyncio
import json
from contextlib import asynccontextmanager

import pytest
from aegra_api.services.graph_factory import generate_graph
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from openinference.instrumentation.langchain import LangChainInstrumentor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import Tracer
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from pydantic import BaseModel

from agent_playground.observability import execution_trace

type Tracing = tuple[Tracer, InMemorySpanExporter]


class TraceState(BaseModel):
    value: str


@pytest.fixture(scope="module")
def tracing():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()

    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    LangChainInstrumentor().instrument(tracer_provider=provider)
    yield provider.get_tracer("test"), exporter
    LangChainInstrumentor().uninstrument()
    provider.shutdown()


@pytest.mark.parametrize("failure", [False, True])
def test_factory_restores_persisted_parent_and_cleans_up(
    tracing: Tracing, failure: bool
):
    tracer, exporter = tracing

    exporter.clear()

    with tracer.start_as_current_span("server.agent") as parent:
        carrier: dict[str, str] = {}

        TraceContextTextMapPropagator().inject(carrier)
        trace_id = parent.get_span_context().trace_id
        parent_id = parent.get_span_context().span_id

    config: RunnableConfig = json.loads(
        json.dumps(
            {
                "metadata": {"otel_trace_context": carrier, "agui_run_id": "submit"},
                "configurable": {"thread_id": "thread", "run_id": "aegra-run"},
            }
        )
    )

    @asynccontextmanager
    async def factory():
        with execution_trace(config):

            def work(state: TraceState):
                return {"value": state.value}

            builder = StateGraph(TraceState)

            builder.add_node("work", work)
            builder.add_edge(START, "work")
            builder.add_edge("work", END)
            yield builder.compile()

    async def execute():
        before = trace.get_current_span().get_span_context()

        try:
            # This is Aegra's supported lifecycle for a context-manager factory.
            async with generate_graph(factory(), "tracing-test") as graph:
                assert not isinstance(graph, StateGraph)
                await graph.ainvoke({"value": "work"})

                if failure:
                    raise RuntimeError("Controlled failure")
        except RuntimeError:
            assert failure

        assert trace.get_current_span().get_span_context() == before

    asyncio.run(execute())
    spans = exporter.get_finished_spans()
    execution = next(span for span in spans if span.name == "agent.execute")

    assert execution.context is not None
    assert execution.parent is not None
    assert execution.attributes is not None
    assert execution.context.trace_id == trace_id
    assert execution.parent.span_id == parent_id
    assert execution.attributes["langfuse.session.id"] == "thread"
    assert execution.attributes["langfuse.trace.metadata.agui_run_id"] == "submit"
    assert execution.attributes["langfuse.trace.metadata.aegra_run_id"] == "aegra-run"
    assert all(span.context and span.context.trace_id == trace_id for span in spans)
    assert execution.status.is_ok is not failure


def test_concurrent_executions_keep_their_own_trace(tracing: Tracing):
    tracer, exporter = tracing

    exporter.clear()
    configs: list[RunnableConfig] = []
    expected: list[int] = []

    for _ in range(2):
        with tracer.start_as_current_span("submit") as parent:
            carrier: dict[str, str] = {}

            TraceContextTextMapPropagator().inject(carrier)
            configs.append({"metadata": {"otel_trace_context": carrier}})
            expected.append(parent.get_span_context().trace_id)

    async def execute(config: RunnableConfig):
        with execution_trace(config):
            await asyncio.sleep(0.01)
            assert trace.get_current_span().get_span_context().is_valid

            return trace.get_current_span().get_span_context().trace_id

    async def check():
        assert (
            await asyncio.gather(*(execute(config) for config in configs)) == expected
        )
        assert not trace.get_current_span().get_span_context().is_valid

    asyncio.run(check())


def test_invalid_carrier_is_ignored(tracing: Tracing):
    _, exporter = tracing

    exporter.clear()

    with execution_trace({"metadata": {"otel_trace_context": {"traceparent": 42}}}):
        assert trace.get_current_span().get_span_context().is_valid

    assert not trace.get_current_span().get_span_context().is_valid
