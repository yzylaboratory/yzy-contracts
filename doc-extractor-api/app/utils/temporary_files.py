from __future__ import annotations

import contextlib
import logging
import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def temporary_document_path(suffix: str = "") -> Iterator[Path]:
    """Create an isolated temporary directory and yield a target file path inside it.

    Guarantees deletion of the directory and all intermediate artifacts on exit or error.
    """
    safe_suffix = suffix if suffix.startswith(".") or not suffix else f".{suffix}"
    temp_dir = Path(tempfile.mkdtemp(prefix="doc_extractor_"))
    try:
        os.chmod(temp_dir, 0o700)
        file_path = temp_dir / f"source{safe_suffix}"
        yield file_path
    finally:
        try:
            shutil.rmtree(temp_dir, ignore_errors=False)
        except FileNotFoundError:
            pass
        except Exception as exc:
            logger.warning(
                "Failed to remove temporary directory cleanly",
                extra={"temp_dir": str(temp_dir), "error_type": type(exc).__name__},
            )
            shutil.rmtree(temp_dir, ignore_errors=True)
