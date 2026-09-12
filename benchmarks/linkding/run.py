"""Prepare or capture one real Linkding baseline. Requires Python 3.11+ and uv."""

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CHECKOUT = ROOT / ".scratch" / "linkding"
MANIFEST = json.loads((HERE / "manifest.json").read_text())


def command(args, checkout=CHECKOUT, **kwargs):
    return subprocess.run(args, cwd=checkout, check=True, **kwargs)


def git_output(*args, checkout=CHECKOUT):
    return command(
        ["git", *args], checkout=checkout, capture_output=True, text=True
    ).stdout.strip()


def ensure_source(checkout=CHECKOUT, expected_patch=None):
    if git_output("rev-parse", "HEAD", checkout=checkout) != MANIFEST["revision"]:
        raise RuntimeError("Linkding revision does not match the manifest")
    if expected_patch is not None:
        if git_output("diff", "HEAD", checkout=checkout) != expected_patch.strip():
            raise RuntimeError("Mutation source differs from the recorded patch")
        if git_output("ls-files", "--others", "--exclude-standard", checkout=checkout):
            raise RuntimeError("Mutant checkout contains untracked source files")
    elif git_output("status", "--porcelain", checkout=checkout):
        raise RuntimeError(
            "Linkding has source changes or untracked files; refusing to call this a clean baseline"
        )


def setup():
    if not CHECKOUT.exists():
        CHECKOUT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", MANIFEST["repository"], str(CHECKOUT)], check=True
        )
        command(["git", "checkout", "--detach", MANIFEST["revision"]])
    ensure_source()
    command(["uv", "sync", "--locked", "--python", MANIFEST["python"]])
    command(["npm", "ci"])
    for directory in ("assets", "favicons", "previews"):
        (CHECKOUT / "data" / directory).mkdir(parents=True, exist_ok=True)
    command(["uv", "run", "--frozen", "manage.py", "migrate"])
    command(["uv", "run", "--frozen", "playwright", "install", "chromium"])
    command(["npm", "run", "build"])
    command(["uv", "run", "--frozen", "manage.py", "collectstatic", "--no-input"])
    ensure_source()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_test(args, environment, log, checkout=CHECKOUT):
    # Stop the entire uv/pytest/browser process group on interruption or timeout.
    with subprocess.Popen(
        args,
        cwd=checkout,
        env=environment,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    ) as process:
        try:
            return process.wait(timeout=120)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise


def observations(output):
    evidence = json.loads((output / "evidence.json").read_text())
    before = json.loads((output / "database-before.json").read_text())
    after = json.loads((output / "database-after.json").read_text())
    reports = evidence["test_reports"]
    if evidence["runtime"]["python"] != MANIFEST["python"]:
        raise RuntimeError("Python runtime does not match the manifest; rerun setup")
    if evidence["collection_errors"] or evidence["pytest_exit_status"] != 0:
        raise RuntimeError("Test or evidence collection failed")
    for observed in evidence["events"]:
        details = observed["metadata"]
        if (
            observed["event"] in ("page_error", "request_failed")
            or (
                observed["source"] in ("application_log", "browser_console")
                and str(details.get("level", "")).upper() in ("ERROR", "CRITICAL")
            )
            or (
                observed["source"] == "http"
                and observed["event"] == "response"
                and details["status"] >= 400
            )
        ):
            raise RuntimeError(
                f"Captured runtime error prevents a clean baseline: {observed['id']}"
            )
    if (
        len(reports) != 3
        or {r["phase"] for r in reports} != {"setup", "call", "teardown"}
        or any(
            r["outcome"] != "passed" or r["node_id"] != MANIFEST["test"]
            for r in reports
        )
    ):
        raise RuntimeError(
            "Expected one passing test with successful setup and teardown"
        )
    requests = [
        e["metadata"]
        for e in evidence["events"]
        if e["source"] == "http"
        and e["event"] == "request"
        and e["metadata"].get("form", {}).get("archive")
    ]
    if len(requests) != 1:
        raise RuntimeError("Expected exactly one observed archive request")
    request = requests[0]
    responses = [
        e["metadata"]
        for e in evidence["events"]
        if e["source"] == "http"
        and e["event"] == "response"
        and e["metadata"]["request_id"] == request["request_id"]
    ]
    if (
        request["method"] != "POST"
        or len(responses) != 1
        or responses[0]["status"] != 200
    ):
        raise RuntimeError("Archive POST did not produce an observed HTTP 200 response")
    bookmark_id = int(request["form"]["archive"][0])
    for name in ("browser-0.zip", "page-after.png"):
        if (output / name).stat().st_size == 0:
            raise RuntimeError(f"Missing or empty {name}")
    return before, after, bookmark_id, responses[0]["status"]


def validate_baseline(output):
    before, after, bookmark_id, status = observations(output)
    prior = {row["id"]: row for row in before["bookmarks"]}
    final = {row["id"]: row for row in after["bookmarks"]}
    if set(prior) != set(final) or not prior or bookmark_id not in prior:
        raise RuntimeError("Baseline lost or added bookmark rows")
    if prior[bookmark_id]["is_archived"] or not final[bookmark_id]["is_archived"]:
        raise RuntimeError("Baseline did not archive the requested bookmark")
    changes = []
    for row_id, row in prior.items():
        for field, value in row.items():
            if final[row_id][field] != value:
                changes.append(
                    {
                        "bookmark_id": row_id,
                        "field": field,
                        "before": value,
                        "after": final[row_id][field],
                    }
                )
                if row_id != bookmark_id or field not in (
                    "is_archived",
                    "date_modified",
                ):
                    raise RuntimeError("Unexpected bookmark change in clean baseline")
    if (
        before["tags"] != after["tags"]
        or before["bookmark_tags"] != after["bookmark_tags"]
    ):
        raise RuntimeError("Baseline changed tags or bookmark/tag associations")
    return {
        "accepted": True,
        "archived_bookmark_id": bookmark_id,
        "bookmark_count_before": len(prior),
        "bookmark_count_after": len(final),
        "archive_http_status": status,
        "changes": changes,
    }


def baseline(checkout=CHECKOUT, expected_patch=None, validator=validate_baseline):
    ensure_source(checkout, expected_patch)
    run_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    )
    output = ROOT / ".scratch" / "runs" / "linkding" / run_id
    output.mkdir(parents=True)
    environment = {
        **os.environ,
        "BG_RUN_DIR": str(output),
        "PYTHONPATH": os.pathsep.join((str(HERE), str(checkout))),
    }
    environment.pop("PYTEST_ADDOPTS", None)
    args = [
        "uv",
        "run",
        "--frozen",
        "--no-sync",
        "pytest",
        MANIFEST["test"],
        "-o",
        "python_files=e2e_test_*.py",
        "--ds",
        "beyond_green_settings",
        "-p",
        "beyond_green_linkding",
        f"--junitxml={output / 'junit.xml'}",
    ]
    metadata = {
        "run_id": run_id,
        "kind": "archive_delete_mutant" if expected_patch else "clean_baseline",
        **MANIFEST,
        "source_test_sha256": digest(checkout / MANIFEST["test"].split("::")[0]),
        "uv_lock_sha256": digest(checkout / "uv.lock"),
        "npm_lock_sha256": digest(checkout / "package-lock.json"),
        "collector_sha256": digest(HERE / "beyond_green_linkding.py"),
        "runner_sha256": digest(HERE / "run.py"),
        "settings_sha256": digest(HERE / "beyond_green_settings.py"),
        "command": args,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    if expected_patch:
        (output / "mutation.patch").write_text(expected_patch + "\n")
    print(f"Capturing {metadata['kind']} in {output}", flush=True)
    try:
        with (output / "pytest.log").open("w") as log:
            metadata["exit_code"] = run_test(args, environment, log, checkout)
        print((output / "pytest.log").read_text())
        ensure_source(checkout, expected_patch)
        if metadata["exit_code"]:
            raise RuntimeError("Upstream test failed; see pytest.log")
        metadata["validation"] = validator(output)
    except (Exception, KeyboardInterrupt) as error:
        metadata["validation"] = {"accepted": False, "error": str(error)}
        raise
    finally:
        metadata["finished_at"] = datetime.now(timezone.utc).isoformat()
        metadata["artifact_sha256"] = {
            p.name: digest(p)
            for p in output.iterdir()
            if p.is_file() and p.suffix != ".sqlite3"
        }
        (output / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata["validation"], indent=2))
    print(f"Run validated: {output / 'run.json'}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup", action="store_true")
    arguments = parser.parse_args()
    try:
        setup() if arguments.setup else baseline()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Linkding benchmark failed: {error}", file=sys.stderr)
        sys.exit(1)
