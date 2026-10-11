"""Validate the supported SELECT syntax and fixed demonstration schema."""

import sqlglot
from sqlglot import exp
from sqlglot.errors import OptimizeError, ParseError
from sqlglot.optimizer.qualify import qualify

from agent_playground.services.sql.models import SqlCheck

ORDERS_SCHEMA: dict[str, object] = {
    "orders": {
        "id": "BIGINT",
        "customer_id": "BIGINT",
        "created_at": "TIMESTAMP",
        "status": "TEXT",
        "amount": "DECIMAL",
    }
}


def check_sql(sql: str) -> SqlCheck:
    try:
        statements = sqlglot.parse(sql, read="postgres")

        if len(statements) != 1 or not isinstance(statements[0], exp.Select):
            return SqlCheck(passed=False, issues=["Provide one SELECT statement."])

        query = statements[0]
        tables = list(query.find_all(exp.Table))
        cte_names = {cte.alias for cte in query.find_all(exp.CTE)}
        available_table_names = {"orders", *cte_names}
        references_unavailable_table = any(
            table.name not in available_table_names for table in tables
        )

        if references_unavailable_table:
            return SqlCheck(
                passed=False, issues=["Only the demo orders table is available."]
            )

        queries_orders = any(table.name == "orders" for table in tables)

        if not queries_orders:
            return SqlCheck(passed=False, issues=["Query the demo orders table."])

        contains_mutation = any(
            isinstance(node, (exp.DML, exp.DDL)) for node in query.walk()
        )

        if contains_mutation:
            return SqlCheck(passed=False, issues=["Data mutations are not supported."])

        for selection in query.find_all(exp.Select):
            selects_all_columns = any(
                expression.is_star for expression in selection.expressions
            )

            if selects_all_columns:
                return SqlCheck(
                    passed=False, issues=["Replace SELECT * with explicit columns."]
                )

        # Resolve aliases and column references only after rejecting unsupported
        # statement structure; qualification validates the fixed demo schema.
        qualify(query, dialect="postgres", schema=ORDERS_SCHEMA)
    except RecursionError:
        return SqlCheck(
            passed=False,
            issues=[
                "The query is too complex to validate. Simplify nested expressions."
            ],
        )
    except (ParseError, OptimizeError) as error:
        return SqlCheck(passed=False, issues=[str(error)])

    return SqlCheck(passed=True, issues=[])
