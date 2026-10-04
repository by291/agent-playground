"""Count CSV rows and total columns containing only numeric values."""

import csv
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path


def summarize(source: Path) -> dict[str, object]:
    with source.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames or []
        totals = {column: Decimal(0) for column in columns}
        numeric = set(columns)
        rows = 0

        for row in reader:
            rows += 1

            for column in columns:
                value = row.get(column) or ""

                if not value.strip():
                    continue

                try:
                    number = Decimal(value)

                    if not number.is_finite():
                        raise InvalidOperation

                    totals[column] += number
                except InvalidOperation:
                    numeric.discard(column)

    return {
        "rows": rows,
        "columns": columns,
        "numericTotals": {
            column: float(totals[column]) for column in columns if column in numeric
        },
    }


def main() -> None:
    source, output = map(Path, sys.argv[1:])
    result = summarize(source)
    output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
