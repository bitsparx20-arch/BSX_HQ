"""Local filesystem blob storage for document PDFs."""
import os
from pathlib import Path

ROOT_DIR = Path(__file__).parent
BLOB_ROOT = Path(os.environ.get("BLOB_STORAGE_PATH", str(ROOT_DIR / "blob_storage")))
DOCUMENTS_DIR = BLOB_ROOT / "documents"
MAX_PDF_BYTES = 25 * 1024 * 1024  # 25 MB


def ensure_dirs() -> None:
    DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)


def blob_path(blob_key: str) -> Path:
    safe = Path(blob_key).name
    return DOCUMENTS_DIR / safe


def save_pdf(blob_key: str, data: bytes) -> int:
    ensure_dirs()
    if len(data) > MAX_PDF_BYTES:
        raise ValueError("File exceeds 25 MB limit")
    if not data.startswith(b"%PDF"):
        raise ValueError("Only PDF files are allowed")
    path = blob_path(blob_key)
    path.write_bytes(data)
    return len(data)


def read_pdf(blob_key: str) -> bytes:
    path = blob_path(blob_key)
    if not path.is_file():
        raise FileNotFoundError(blob_key)
    return path.read_bytes()


def delete_pdf(blob_key: str) -> None:
    path = blob_path(blob_key)
    if path.is_file():
        path.unlink()


def replace_pdf(blob_key: str, data: bytes) -> int:
    delete_pdf(blob_key)
    return save_pdf(blob_key, data)
