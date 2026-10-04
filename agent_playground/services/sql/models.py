"""Request and response contracts for the SQL service."""

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    task: str = Field(min_length=1, max_length=10000)


class CheckRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=100000)


class SubmitRequest(CheckRequest):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,200}$")


class SqlSource(BaseModel):
    sql: str
    dialect: str
    schema_text: str


class SqlCheck(BaseModel):
    passed: bool
    issues: list[str]


class SqlSubmission(BaseModel):
    id: str
    sql: str
    status: str
