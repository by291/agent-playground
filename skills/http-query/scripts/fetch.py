"""Fetch one JSON response without redirects and save bounded response data."""

import json
import sys
from pathlib import Path

import httpx


def main() -> None:
    url, output = sys.argv[1:]
    data = bytearray()

    with httpx.stream("GET", url, timeout=20, follow_redirects=False) as response:
        response.raise_for_status()

        for chunk in response.iter_bytes():
            data.extend(chunk)

            if len(data) > 10 * 1024 * 1024:
                raise ValueError("API response exceeds 10 MiB")

    result = json.loads(data)
    Path(output).write_bytes(data)
    print(json.dumps(result)[:16000])


if __name__ == "__main__":
    main()
