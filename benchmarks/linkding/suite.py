"""Capture labeled real-app cases; ground truth never enters model evidence."""

import copy
import json
from pathlib import Path
from uuid import uuid4

from experiment import create_checkout, normalized, validate_mutant
from run import HERE, MANIFEST, ROOT, baseline, digest, ensure_source, git_output, observations, validate_baseline

VARIANTS = {
    "archive_deletes_bookmark": "    bookmark.delete()\n",
    "archive_toggles_unread": (
        "    archive_bookmark(bookmark)\n"
        "    bookmark.unread = not bookmark.unread\n"
        "    bookmark.save(update_fields=['unread'])\n"
    ),
    "archive_clears_tags": "    archive_bookmark(bookmark)\n    bookmark.tags.clear()\n",
    "archive_changes_other_owner": (
        "    archive_bookmark(bookmark)\n"
        "    other = Bookmark.objects.exclude(owner_id=bookmark.owner_id).order_by('id').first()\n"
        "    other.unread = not other.unread\n"
        "    other.save(update_fields=['unread'])\n"
    ),
    "archive_refresh_control": "    archive_bookmark(bookmark)\n    bookmark.refresh_from_db()\n",
}


def validate_state(before, after, target_id, case_id):
    prior = {row["id"]: row for row in before["bookmarks"]}
    final = {row["id"]: row for row in after["bookmarks"]}
    if target_id not in prior or prior[target_id]["is_archived"]:
        raise RuntimeError("Target must initially exist and be active")
    if len(prior) != len(before["bookmarks"]) or len(final) != len(after["bookmarks"]):
        raise RuntimeError("Duplicate bookmark IDs")
    expected = copy.deepcopy(before)
    target = next(row for row in expected["bookmarks"] if row["id"] == target_id)
    if case_id == "archive_deletes_bookmark":
        expected["bookmarks"].remove(target)
        expected["bookmark_tags"] = [row for row in expected["bookmark_tags"] if row["bookmark_id"] != target_id]
    else:
        if target_id not in final:
            raise RuntimeError("Archive target disappeared")
        target.update(is_archived=True, date_modified=final[target_id]["date_modified"])
        if case_id == "archive_toggles_unread":
            target["unread"] = not target["unread"]
        elif case_id == "archive_clears_tags":
            expected["bookmark_tags"] = [row for row in expected["bookmark_tags"] if row["bookmark_id"] != target_id]
            if expected["bookmark_tags"] == before["bookmark_tags"]:
                raise RuntimeError("Tag-loss case must remove an existing association")
        elif case_id == "archive_changes_other_owner":
            others = [row for row in expected["bookmarks"] if row["owner_id"] != target["owner_id"]]
            if not others:
                raise RuntimeError("Cross-owner case requires another owner")
            other = min(others, key=lambda row: row["id"])
            other["unread"] = not other["unread"]
        elif case_id not in ("clean_archive", "archive_refresh_control"):
            raise RuntimeError("Unknown case")
    if after != expected:
        raise RuntimeError(f"State does not match the exact expected change for {case_id}")


def validate_case(output, case_id):
    before, after, target_id, status = observations(output)
    validate_state(before, after, target_id, case_id)
    clean = case_id in ("clean_archive", "archive_refresh_control")
    if clean:
        validate_baseline(output)
    else:
        try:
            validate_baseline(output)
        except RuntimeError:
            pass
        else:
            raise RuntimeError("Defect unexpectedly satisfies the archive contract")
    return {
        "experiment_valid": True, "application_correct": clean,
        "upstream_test_passed": True, "case_id": case_id,
        "target_id": target_id, "archive_http_status": status,
        "bookmark_count_before": len(before["bookmarks"]),
        "bookmark_count_after": len(after["bookmarks"]),
    }


def provenance(current, reference):
    keys = ("revision", "test", "source_test_sha256", "uv_lock_sha256", "npm_lock_sha256", "collector_sha256", "runner_sha256", "settings_sha256")
    actual = json.loads((current / "run.json").read_text())
    clean = json.loads((reference / "run.json").read_text())
    if any(actual[key] != clean[key] for key in keys):
        raise RuntimeError("Suite source, test, or collector provenance differs")
    before = json.loads((current / "database-before.json").read_text())
    reference_before = json.loads((reference / "database-before.json").read_text())
    if normalized(before) != normalized(reference_before):
        raise RuntimeError("Suite fixtures differ")
    runtime = json.loads((current / "evidence.json").read_text())["runtime"]
    if runtime != json.loads((reference / "evidence.json").read_text())["runtime"]:
        raise RuntimeError("Suite runtimes differ")
    return {**{key: actual[key] for key in keys}, "runtime": runtime,
            "artifact_sha256": actual["artifact_sha256"], "run_sha256": digest(current / "run.json")}


def suite():
    ensure_source()
    output = ROOT / ".scratch" / "suites" / uuid4().hex
    output.mkdir(parents=True)
    clean = baseline()
    report = {"schema_version": 1, "baseline": str(clean), "cases": [],
              "suite_sha256": digest(Path(__file__)), "manifest_sha256": digest(HERE / "manifest.json")}

    def add(case_id, run):
        validation = validate_case(run, case_id)
        report["cases"].append({
            "id": case_id, "expected": "clean" if validation["application_correct"] else "regression",
            "currentDir": str(run), "baselineDir": str(clean), "validation": validation,
            "provenance": provenance(run, clean),
        })
        (output / "suite.partial.json").write_text(json.dumps(report, indent=2) + "\n")

    add("clean_archive", clean)
    anchor = ("def archive(request: HttpRequest, bookmark_id: int | str):\n"
              "    bookmark = access.bookmark_write(request, bookmark_id)\n"
              "    archive_bookmark(bookmark)\n")
    for case_id, replacement in VARIANTS.items():
        checkout = create_checkout()
        source = checkout / "bookmarks/views/bookmarks.py"
        original = source.read_text()
        if original.count(anchor) != 1:
            raise RuntimeError("Expected archive implementation not found exactly once")
        source.write_text(original.replace(anchor, anchor.rsplit("    archive_bookmark(bookmark)\n", 1)[0] + replacement, 1))
        patch = git_output("diff", "HEAD", checkout=checkout)
        if git_output("diff", "--name-only", "HEAD", checkout=checkout) != "bookmarks/views/bookmarks.py":
            raise RuntimeError("Unexpected source file changed")
        run = baseline(checkout=checkout, expected_patch=patch,
                       validator=lambda directory: validate_case(directory, case_id))
        add(case_id, run)
    ensure_source()
    report["complete"] = True
    path = output / "suite.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Validated suite: {path}")


if __name__ == "__main__":
    suite()
