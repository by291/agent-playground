"""Python-owned application DDL and server-owned conversation query contracts.

Python owns workflow outputs, SQL/report demo jobs and A2A tasks/jobs.
The TypeScript server owns conversations and conversation_runs; their columns
here support queries.
"""

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

metadata = MetaData(schema="public")
conversations = Table(
    "conversations",
    metadata,
    Column("thread_id", String, primary_key=True),
    Column("next_output_seq", BigInteger, nullable=False),
    extend_existing=True,
)
conversation_runs = Table(
    "conversation_runs",
    metadata,
    Column("agui_run_id", String, primary_key=True),
    Column("thread_id", String, nullable=False),
    extend_existing=True,
)
workflow_outputs = Table(
    "workflow_outputs",
    metadata,
    Column("id", String, primary_key=True),
    Column("thread_id", String, nullable=False),
    Column("agui_run_id", String, nullable=False),
    Column("workflow_call_id", String, nullable=False),
    Column("step_id", String, nullable=False),
    Column("step_seq", Integer, nullable=False),
    Column("output_seq", BigInteger, nullable=False),
    Column("kind", String, nullable=False, server_default="a2ui"),
    Column("version", Integer, nullable=False, server_default="1"),
    Column("payload", JSONB, nullable=False),
    Column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    ),
    UniqueConstraint("thread_id", "workflow_call_id", "step_id", "version"),
    UniqueConstraint("thread_id", "output_seq"),
)

sql_demo_submissions = Table(
    "sql_demo_submissions",
    metadata,
    Column("id", String, primary_key=True),
    Column("sql", Text, nullable=False),
    Column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    ),
)

report_jobs = Table(
    "report_demo_jobs",
    metadata,
    Column("id", String, primary_key=True),
    Column("task", Text, nullable=False),
    Column("callback_token", String, nullable=False),
    Column("outcome", String, nullable=False),
    Column("delivered_revision", Integer, nullable=False, server_default="0"),
    Column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    ),
)

a2a_tasks = Table(
    "a2a_demo_tasks",
    metadata,
    Column("role", String, primary_key=True),
    Column("id", String, primary_key=True),
    Column("context_id", String, nullable=False),
    Column("state", Integer, nullable=False),
    Column("payload", JSONB, nullable=False),
    Column(
        "updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    ),
)

a2a_jobs = Table(
    "a2a_demo_jobs",
    metadata,
    Column("id", String, primary_key=True),
    Column("request", JSONB, nullable=False),
    Column("state", JSONB, nullable=False),
    Column("delivered_revision", Integer, nullable=False, server_default="0"),
    Column("lease_owner", String),
    Column("lease_until", DateTime(timezone=True)),
)
