"""Exercise the bundled CSV script against known input bytes."""

import json
import subprocess
import sys
from pathlib import Path


def test_csv_example_reports_rows_and_numeric_totals(tmp_path: Path):
    source = tmp_path / "orders.csv"
    source.write_text("item,amount\nalpha,12\nbeta,8\n")
    output = tmp_path / "summary.json"
    result = subprocess.run(
        [
            sys.executable,
            "skills/csv-summary/scripts/summarize.py",
            str(source),
            str(output),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(output.read_text()) == {
        "rows": 2,
        "columns": ["item", "amount"],
        "numericTotals": {"amount": 20.0},
    }
