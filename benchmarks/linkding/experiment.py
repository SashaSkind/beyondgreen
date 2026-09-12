"""Prove a source-injected archive defect escapes the unchanged browser test."""

import json
import shutil
import subprocess
import sys
from uuid import uuid4

from run import (
    CHECKOUT,
    MANIFEST,
    ROOT,
    baseline,
    ensure_source,
    git_output,
    observations,
    validate_baseline,
)


def validate_mutant(output):
    before, after, bookmark_id, status = observations(output)
    prior = {row["id"]: row for row in before["bookmarks"]}
    final = {row["id"]: row for row in after["bookmarks"]}
    if bookmark_id not in prior or prior[bookmark_id]["is_archived"]:
        raise RuntimeError("The archive target must initially exist and be active")
    if set(final) != set(prior) - {bookmark_id}:
        raise RuntimeError("Mutant did not delete exactly the requested bookmark")
    if any(row != prior[row_id] for row_id, row in final.items()):
        raise RuntimeError("Mutant changed surviving bookmark rows")
    expected_relations = [
        row for row in before["bookmark_tags"] if row["bookmark_id"] != bookmark_id
    ]
    if after["bookmark_tags"] != expected_relations or after["tags"] != before["tags"]:
        raise RuntimeError("Unexpected tag or association changes in mutant")
    try:
        validate_baseline(output)
    except RuntimeError as error:
        if str(error) != "Baseline lost or added bookmark rows":
            raise RuntimeError(
                "Clean validator rejected mutant for an unrelated reason"
            ) from error
    else:
        raise RuntimeError("Clean validator unexpectedly accepted the deletion")
    return {
        "experiment_valid": True,
        "application_correct": False,
        "upstream_test_passed": True,
        "regression": "archive_deletes_bookmark",
        "deleted_bookmark_id": bookmark_id,
        "bookmark_count_before": len(prior),
        "bookmark_count_after": len(final),
        "archive_http_status": status,
        "removed_tag_associations": len(before["bookmark_tags"])
        - len(after["bookmark_tags"]),
        "clean_validator_rejected": True,
    }


def normalized(snapshot):
    return {
        **snapshot,
        "bookmarks": [
            {
                key: value
                for key, value in row.items()
                if key not in ("date_added", "date_modified")
            }
            for row in snapshot["bookmarks"]
        ],
    }


def compare(clean, mutant):
    clean_meta = json.loads((clean / "run.json").read_text())
    mutant_meta = json.loads((mutant / "run.json").read_text())
    for key in (
        "revision",
        "test",
        "source_test_sha256",
        "uv_lock_sha256",
        "npm_lock_sha256",
        "collector_sha256",
        "runner_sha256",
        "settings_sha256",
    ):
        if clean_meta[key] != mutant_meta[key]:
            raise RuntimeError(f"Paired runs differ in {key}")
    clean_before = json.loads((clean / "database-before.json").read_text())
    mutant_before = json.loads((mutant / "database-before.json").read_text())
    if normalized(clean_before) != normalized(mutant_before):
        raise RuntimeError("Paired runs started with different fixtures")
    clean_evidence = json.loads((clean / "evidence.json").read_text())
    mutant_evidence = json.loads((mutant / "evidence.json").read_text())
    if clean_evidence["runtime"] != mutant_evidence["runtime"]:
        raise RuntimeError("Paired runs used different runtimes")
    clean_result = validate_baseline(clean)
    mutant_result = validate_mutant(mutant)
    if clean_result["archived_bookmark_id"] != mutant_result["deleted_bookmark_id"]:
        raise RuntimeError("Paired runs acted on different bookmarks")
    return {
        "proven": True,
        "scope": "one selected upstream browser test; full suite not run",
        "clean_run": str(clean),
        "mutant_run": str(mutant),
        "source_revision": MANIFEST["revision"],
        "test": MANIFEST["test"],
        "test_sha256": clean_meta["source_test_sha256"],
        "initial_state_equal_ignoring_timestamps": True,
        "final_screenshots_byte_identical": (clean / "page-after.png").read_bytes()
        == (mutant / "page-after.png").read_bytes(),
        "clean": clean_result,
        "mutant": mutant_result,
        "ai_used": False,
    }


def create_checkout():
    ensure_source()
    # Fresh independent git metadata and application files; the original stays clean.
    checkout = ROOT / ".scratch" / "linkding-mutants" / uuid4().hex[:12]
    checkout.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", "--shared", str(CHECKOUT), str(checkout)], check=True
    )
    subprocess.run(
        ["git", "checkout", "--detach", MANIFEST["revision"]], cwd=checkout, check=True
    )
    # Reuse the pinned installed runtime and identical built assets, without syncing
    # packages or building into the shared directories during an experiment.
    (checkout / ".venv").symlink_to(CHECKOUT / ".venv", target_is_directory=True)
    (checkout / "static").symlink_to(CHECKOUT / "static", target_is_directory=True)
    for pattern in ("bundle.js*", "theme-*.css*"):
        for asset in (CHECKOUT / "bookmarks/static").glob(pattern):
            shutil.copy2(asset, checkout / "bookmarks/static" / asset.name)
    for directory in ("assets", "favicons", "previews"):
        (checkout / "data" / directory).mkdir(parents=True, exist_ok=True)
    ensure_source(checkout)
    return checkout


def experiment():
    checkout = create_checkout()

    source = checkout / "bookmarks/views/bookmarks.py"
    original = source.read_text()
    before = (
        "def archive(request: HttpRequest, bookmark_id: int | str):\n"
        "    bookmark = access.bookmark_write(request, bookmark_id)\n"
        "    archive_bookmark(bookmark)\n"
    )
    after = before.replace("archive_bookmark(bookmark)", "bookmark.delete()")
    if original.count(before) != 1:
        raise RuntimeError("Expected archive implementation not found exactly once")
    source.write_text(original.replace(before, after, 1))
    patch = git_output("diff", "HEAD", checkout=checkout)
    if (
        git_output("diff", "--name-only", "HEAD", checkout=checkout)
        != "bookmarks/views/bookmarks.py"
    ):
        raise RuntimeError("Mutation changed an unexpected source file")

    clean = baseline()
    mutant = baseline(
        checkout=checkout, expected_patch=patch, validator=validate_mutant
    )
    result = compare(clean, mutant)
    result["mutant_checkout"] = str(checkout)
    ensure_source()
    report = mutant / "comparison.json"
    report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    print(f"Experiment proven: {report}")


if __name__ == "__main__":
    try:
        experiment()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Linkding experiment failed: {error}", file=sys.stderr)
        sys.exit(1)
