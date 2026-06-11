"""Blob storage for note images."""
import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).parent
BLOB_ROOT = Path(os.environ.get("BLOB_STORAGE_PATH", str(ROOT_DIR / "blob_storage")))
NOTES_IMAGES_DIR = BLOB_ROOT / "notes"
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def ensure_note_image_dirs() -> None:
    NOTES_IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def image_blob_path(blob_key: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "", Path(blob_key).name)
    return NOTES_IMAGES_DIR / safe


def save_note_image(blob_key: str, data: bytes, content_type: str) -> int:
    ensure_note_image_dirs()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError("Only JPEG, PNG, GIF, and WebP images are allowed")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds 8 MB limit")
    path = image_blob_path(blob_key)
    path.write_bytes(data)
    return len(data)


def read_note_image(blob_key: str) -> tuple[bytes, str]:
    path = image_blob_path(blob_key)
    if not path.is_file():
        raise FileNotFoundError(blob_key)
    ext = path.suffix.lower()
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")
    return path.read_bytes(), mime


def delete_note_image(blob_key: str) -> None:
    path = image_blob_path(blob_key)
    if path.is_file():
        path.unlink()
