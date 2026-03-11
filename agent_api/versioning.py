from __future__ import annotations

import os
import subprocess
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from agent_api.config import BASE_DIR

STARTED_AT = os.getenv("AGENT_STARTED_AT", datetime.now().isoformat(timespec="seconds"))


@lru_cache(maxsize=1)
def _git_info() -> dict[str, str | None]:
    repo = Path(BASE_DIR)

    def run(args: list[str]) -> str | None:
        try:
            return subprocess.check_output(["git", *args], cwd=repo, text=True, stderr=subprocess.DEVNULL).strip()
        except Exception:  # noqa: BLE001
            return None

    return {
        "branch": run(["rev-parse", "--abbrev-ref", "HEAD"]),
        "commit": run(["rev-parse", "--short", "HEAD"]),
        "dirty": "true" if run(["status", "--porcelain"]) else "false",
    }


def get_runtime_version() -> dict[str, str]:
    git = _git_info()
    build = os.getenv("AGENT_BUILD_VERSION") or git.get("commit") or "unknown"
    return {
        "build": str(build),
        "branch": str(git.get("branch") or "unknown"),
        "commit": str(git.get("commit") or "unknown"),
        "dirty": str(git.get("dirty") or "unknown"),
        "started_at": STARTED_AT,
    }
