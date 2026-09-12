"""Read-only observers for the pinned upstream browser test; no assertion edits."""

import json
import logging
import os
import platform
import threading
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

RUN_DIR = Path(os.environ["BG_RUN_DIR"])
EVENTS = []
ERRORS = []
REPORTS = []
LOCK = threading.Lock()


def event(source, name, **metadata):
    with LOCK:
        EVENTS.append(
            {
                "id": f"event-{len(EVENTS) + 1}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": source,
                "event": name,
                "metadata": metadata,
            }
        )


def write_json(name, data):
    (RUN_DIR / name).write_text(json.dumps(data, indent=2, default=str) + "\n")


def capture_error(stage, error):
    ERRORS.append({"stage": stage, "type": type(error).__name__, "message": str(error)})


def snapshot(name):
    from bookmarks.models import Bookmark, Tag

    data = {
        "bookmarks": list(
            Bookmark.objects.order_by("id").values(
                "id",
                "owner_id",
                "title",
                "url",
                "is_archived",
                "unread",
                "shared",
                "date_added",
                "date_modified",
            )
        ),
        "tags": list(Tag.objects.order_by("id").values("id", "owner_id", "name")),
        "bookmark_tags": list(
            Bookmark.tags.through.objects.order_by("bookmark_id", "tag_id").values(
                "bookmark_id", "tag_id"
            )
        ),
    }
    write_json(f"database-{name}.json", data)
    event("database", "snapshot", phase=name, bookmark_count=len(data["bookmarks"]))


class EvidenceLogHandler(logging.Handler):
    def emit(self, record):
        event(
            "application_log",
            "message",
            logger=record.name,
            level=record.levelname,
            message=record.getMessage(),
        )


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_call(item):
    from bookmarks.tests_e2e.helpers import LinkdingE2ETestCase

    original_open = LinkdingE2ETestCase.open
    original_browser = LinkdingE2ETestCase.setup_browser
    original_teardown = LinkdingE2ETestCase.tearDown
    captured_before = False
    requests = {}
    contexts = []

    def observe(callback):
        def safe_callback(value):
            try:
                callback(value)
            except Exception as error:
                capture_error("browser_event", error)

        return safe_callback

    def on_request(request):
        request_id = f"request-{len(requests) + 1}"
        requests[request] = request_id
        parsed = urlsplit(request.url)
        form = parse_qs(request.post_data or "") if request.method == "POST" else {}
        event(
            "http",
            "request",
            request_id=request_id,
            method=request.method,
            origin=f"{parsed.scheme}://{parsed.netloc}",
            path=parsed.path,
            form={
                key: form[key]
                for key in ("archive", "unarchive", "remove")
                if key in form
            },
        )

    def on_response(response):
        event(
            "http",
            "response",
            request_id=requests.get(response.request),
            status=response.status,
            content_type=response.headers.get("content-type"),
        )

    def open_observed(self, url):
        nonlocal captured_before
        if not captured_before:
            try:
                snapshot("before")
                captured_before = True
            except Exception as error:
                capture_error("database_before", error)
        return original_open(self, url)

    def browser_observed(self):
        context = original_browser(self)
        contexts.append(context)
        try:
            context.tracing.start(screenshots=True, snapshots=True, sources=False)
            context.on("request", observe(on_request))
            context.on("response", observe(on_response))
            context.on(
                "requestfailed",
                observe(
                    lambda request: event(
                        "http",
                        "request_failed",
                        request_id=requests.get(request),
                        failure=request.failure,
                    )
                ),
            )
            context.on(
                "console",
                observe(
                    lambda message: event(
                        "browser_console",
                        "message",
                        level=message.type,
                        message=message.text,
                    )
                ),
            )
            context.on(
                "weberror",
                observe(
                    lambda error: event(
                        "browser_console", "page_error", message=str(error.error)
                    )
                ),
            )
            event("browser", "started", version=self.browser.version)
        except Exception as error:
            capture_error("browser_start", error)
        return context

    def teardown_observed(self):
        try:
            try:
                snapshot("after")
                if self.page:
                    self.page.screenshot(
                        path=str(RUN_DIR / "page-after.png"), full_page=True
                    )
            except Exception as error:
                capture_error("database_after_or_screenshot", error)
            for index, context in enumerate(contexts):
                try:
                    context.tracing.stop(path=str(RUN_DIR / f"browser-{index}.zip"))
                except Exception as error:
                    capture_error("browser_trace", error)
        finally:
            original_teardown(self)

    handler = EvidenceLogHandler()
    loggers = [
        logging.getLogger(name) for name in ("", "bookmarks", "huey", "django.server")
    ]
    for logger in loggers:
        logger.addHandler(handler)
    LinkdingE2ETestCase.open = open_observed
    LinkdingE2ETestCase.setup_browser = browser_observed
    LinkdingE2ETestCase.tearDown = teardown_observed
    event("test", "started", node_id=item.nodeid)
    try:
        yield
    finally:
        LinkdingE2ETestCase.open = original_open
        LinkdingE2ETestCase.setup_browser = original_browser
        LinkdingE2ETestCase.tearDown = original_teardown
        for logger in loggers:
            logger.removeHandler(handler)


def pytest_runtest_logreport(report):
    REPORTS.append(
        {
            "node_id": report.nodeid,
            "phase": report.when,
            "outcome": report.outcome,
            "duration_seconds": report.duration,
        }
    )


def pytest_sessionfinish(session, exitstatus):
    write_json(
        "evidence.json",
        {
            "schema_version": 1,
            "events": EVENTS,
            "collection_errors": ERRORS,
            "test_reports": REPORTS,
            "pytest_exit_status": int(exitstatus),
            "runtime": {
                "python": platform.python_version(),
                "django": version("django"),
                "playwright": version("playwright"),
                "pytest": version("pytest"),
            },
            "queue": {"isolated": True, "consumer_started": False},
        },
    )
