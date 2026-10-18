"""Encrypted staging storage for uploaded PDFs.

Plaintext PDFs are never written to disk. The API encrypts the validated upload
with AES-256-GCM, and the ingestion worker decrypts it into a private temporary
file that is deleted in a finally block. The key comes only from the
DOCUMENT_ENCRYPTION_KEY environment variable.
"""

import base64
import binascii
import os
import secrets
import tempfile
import threading
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_MAGIC = b"DMENC1"
_AAD = b"docmind-pdf-v1"
_NONCE_BYTES = 12
_KEY_BYTES = 32
_KEY_LOCK = threading.Lock()
_EPHEMERAL_KEY: bytes | None = None


class DocumentStorageError(RuntimeError):
    """Raised when encrypted document storage cannot be read or written."""


def _decode_key(raw: str) -> bytes:
    """Decodes a base64/urlsafe-base64 or hex key and requires 32 bytes."""
    candidate = raw.strip()
    decoded: bytes | None = None
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            decoded = decoder(candidate + ("=" * (-len(candidate) % 4)))
            if len(decoded) == _KEY_BYTES:
                return decoded
        except (binascii.Error, ValueError):
            continue
    try:
        decoded = bytes.fromhex(candidate)
    except ValueError:
        decoded = None
    if decoded is not None and len(decoded) == _KEY_BYTES:
        return decoded
    raise DocumentStorageError("DOCUMENT_ENCRYPTION_KEY must decode to exactly 32 bytes")


def get_storage_key() -> bytes:
    """Returns the configured AES key, or an ephemeral dev key outside production."""
    global _EPHEMERAL_KEY
    raw = os.getenv("DOCUMENT_ENCRYPTION_KEY", "").strip()
    if raw:
        return _decode_key(raw)
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise DocumentStorageError("DOCUMENT_ENCRYPTION_KEY is required in production")
    with _KEY_LOCK:
        if _EPHEMERAL_KEY is None:
            _EPHEMERAL_KEY = secrets.token_bytes(_KEY_BYTES)
        return _EPHEMERAL_KEY


def encryption_ready() -> bool:
    """Reports whether document encryption can be used in this environment."""
    try:
        get_storage_key()
        return True
    except DocumentStorageError:
        return False


class EncryptedDocumentStore:
    """Stores encrypted uploads in an isolated staging directory."""

    def __init__(self, base_path: Path | None = None) -> None:
        data_dir = Path(os.getenv("DOCMIND_DATA_DIR", str(Path(__file__).resolve().parent / ".data")))
        self.base_path = (base_path or Path(os.getenv("DOCMIND_STAGING_DIR", str(data_dir / "staging")))).resolve()
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _safe_path(self, stored_name: str) -> Path:
        """Resolves one staging filename and rejects path traversal."""
        candidate = (self.base_path / Path(stored_name).name).resolve()
        if candidate.parent != self.base_path:
            raise DocumentStorageError("Invalid staging path")
        return candidate

    def stage(self, content: bytes) -> str:
        """Encrypts bytes and returns the staging filename used by the worker."""
        nonce = secrets.token_bytes(_NONCE_BYTES)
        ciphertext = AESGCM(get_storage_key()).encrypt(nonce, content, _AAD)
        stored_name = f"{secrets.token_hex(24)}.pdf.enc"
        path = self._safe_path(stored_name)
        try:
            path.write_bytes(_MAGIC + nonce + ciphertext)
            path.chmod(0o600)
        except OSError as exc:
            path.unlink(missing_ok=True)
            raise DocumentStorageError("Unable to stage uploaded document") from exc
        return stored_name

    def decrypt_to_temp(self, stored_name: str) -> Path:
        """Decrypts a staged upload into a private temporary file for extraction."""
        path = self._safe_path(stored_name)
        try:
            payload = path.read_bytes()
            if not payload.startswith(_MAGIC) or len(payload) <= len(_MAGIC) + _NONCE_BYTES:
                raise DocumentStorageError("Corrupt encrypted document")
            nonce = payload[len(_MAGIC):len(_MAGIC) + _NONCE_BYTES]
            ciphertext = payload[len(_MAGIC) + _NONCE_BYTES:]
            plaintext = AESGCM(get_storage_key()).decrypt(nonce, ciphertext, _AAD)
        except (OSError, ValueError) as exc:
            raise DocumentStorageError("Unable to decrypt staged document") from exc
        temp_dir = self.base_path / "tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        handle = tempfile.NamedTemporaryFile(delete=False, dir=temp_dir, suffix=".pdf")
        try:
            handle.write(plaintext)
            handle.flush()
            os.fsync(handle.fileno())
        finally:
            handle.close()
        Path(handle.name).chmod(0o600)
        return Path(handle.name)

    def purge(self, stored_name: str | None) -> None:
        """Deletes a staged encrypted upload and any decrypted temporary file."""
        if not stored_name:
            return
        try:
            self._safe_path(stored_name).unlink(missing_ok=True)
        except (OSError, DocumentStorageError):
            pass

    def purge_temp(self, path: Path | None) -> None:
        """Deletes one decrypted temporary file."""
        if path is None:
            return
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


document_store = EncryptedDocumentStore()
