"""Print the one-screen summary of a clean/mutant capture pair.

Reads the comparison.json written by experiment.py and reports only the facts
the demo rests on: the upstream test still passed, the final screenshots are
identical, and the persisted state diverged anyway. Validates every field it
prints rather than reporting a missing key as a passing check.
"""

import json
import sys
from pathlib import Path


def require(condition: object, message: str) -> None:
    if not condition:
        raise SystemExit(f"Unusable capture: {message}")


def main(argv: list[str]) -> None:
    require(len(argv) == 2, "pass one path to a comparison.json or its run directory")
    path = Path(argv[1])
    if path.is_dir():
        path = path / "comparison.json"
    require(path.is_file(), f"{path} does not exist")

    data = json.loads(path.read_text(encoding="utf8"))
    for key in ("proven", "final_screenshots_byte_identical", "clean", "mutant", "test"):
        require(key in data, f"missing {key}")
    clean, mutant = data["clean"], data["mutant"]
    for key in ("bookmark_count_before", "bookmark_count_after"):
        require(isinstance(clean.get(key), int) and isinstance(mutant.get(key), int), f"missing {key}")
    require(isinstance(mutant.get("upstream_test_passed"), bool), "missing upstream_test_passed")

    rows = [
        ("test", data["test"].rsplit("::", 1)[-1]),
        ("upstream test", "PASSED" if mutant["upstream_test_passed"] else "FAILED"),
        ("archive HTTP status", mutant.get("archive_http_status", "unknown")),
        ("screenshots identical", data["final_screenshots_byte_identical"]),
        ("clean bookmarks", f"{clean['bookmark_count_before']} -> {clean['bookmark_count_after']}"),
        ("mutant bookmarks", f"{mutant['bookmark_count_before']} -> {mutant['bookmark_count_after']}"),
        ("tag links removed", mutant.get("removed_tag_associations", 0)),
        ("application correct", mutant.get("application_correct")),
    ]
    width = max(len(label) for label, _ in rows)
    for label, value in rows:
        print(f"{label.ljust(width)} : {value}")

    lost = clean["bookmark_count_after"] - mutant["bookmark_count_after"]
    if lost:
        print(f"\n{lost} bookmark row(s) destroyed by an operation the test reports as successful.")


if __name__ == "__main__":
    main(sys.argv)
