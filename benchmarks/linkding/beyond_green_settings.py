"""Upstream development settings with an isolated queue for each benchmark run."""

import os
from pathlib import Path

from bookmarks.settings.dev import *  # noqa: F403

HUEY = {**HUEY, "filename": str(Path(os.environ["BG_RUN_DIR"]) / "tasks.sqlite3")}  # noqa: F405
