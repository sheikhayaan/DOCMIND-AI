"""Active-content sanitization for uploaded PDFs.

The sanitizer rebuilds a PDF with pikepdf and removes JavaScript, launch and
form submission actions, embedded files, XFA payloads, auto-run actions, and
document metadata before any text extraction occurs. It preserves page content
and fonts so legitimate documents remain usable.
"""

import io
import os

import pikepdf

_DANGEROUS_KEYS = {
    "/JavaScript",
    "/JS",
    "/Launch",
    "/ImportData",
    "/GoToE",
    "/GoToR",
    "/SubmitForm",
    "/URI",
    "/Rendition",
    "/Movie",
    "/Sound",
    "/RichMedia",
    "/EmbeddedFiles",
    "/XFA",
    "/OpenAction",
    "/AA",
}
_DANGEROUS_ACTIONS = {
    "/JavaScript",
    "/JS",
    "/Launch",
    "/ImportData",
    "/GoToE",
    "/GoToR",
    "/SubmitForm",
    "/URI",
    "/Rendition",
    "/Movie",
    "/Sound",
    "/RichMedia",
}


class PDFSanitizationError(ValueError):
    """Raised when a PDF cannot be safely sanitized."""


def _is_dangerous_action(value: pikepdf.Object) -> bool:
    """Returns true when an action dictionary contains a blocked action type."""
    try:
        if isinstance(value, pikepdf.Array):
            return any(_is_dangerous_action(item) for item in value)
        if not isinstance(value, pikepdf.Dictionary):
            return False
        action_type = value.get("/S")
        return str(action_type) in _DANGEROUS_ACTIONS if action_type is not None else False
    except Exception:
        return True


def _scrub_object(obj: pikepdf.Object, seen: set[object]) -> None:
    """Recursively removes active-content keys from a PDF object graph."""
    if isinstance(obj, pikepdf.Array):
        for item in list(obj):
            _scrub_object(item, seen)
        return
    if isinstance(obj, pikepdf.Stream):
        obj = obj.stream_dict
    if not isinstance(obj, pikepdf.Dictionary):
        return
    # objgen tuples are stable; id(tuple) can be recycled between recursive calls.
    marker: object = obj.objgen if getattr(obj, "is_indirect", False) else id(obj)
    if marker in seen:
        return
    seen.add(marker)
    for key in list(obj.keys()):
        try:
            if key in _DANGEROUS_KEYS:
                del obj[key]
                continue
            if key == "/A" and _is_dangerous_action(obj[key]):
                del obj[key]
                continue
            _scrub_object(obj[key], seen)
        except (KeyError, TypeError, ValueError):
            continue


def sanitize_pdf(content: bytes) -> bytes:
    """Returns a rebuilt PDF with active content and identifying metadata removed."""
    max_pages = int(os.getenv("MAX_PDF_PAGES", "500"))
    try:
        with pikepdf.open(io.BytesIO(content)) as pdf:
            if len(pdf.pages) > max_pages:
                raise PDFSanitizationError(f"PDF exceeds the {max_pages} page limit")
            for key in ("/OpenAction", "/AA", "/Metadata", "/AcroForm"):
                if key in pdf.Root:
                    del pdf.Root[key]
            _scrub_object(pdf.Root, set())
            _scrub_object(pdf.trailer, set())
            try:
                pdf.docinfo.clear()
            except Exception:
                pass
            if "/Info" in pdf.trailer:
                del pdf.trailer["/Info"]
            output = io.BytesIO()
            pdf.save(output, compress_streams=True)
            sanitized = output.getvalue()
    except PDFSanitizationError:
        raise
    except Exception as exc:
        raise PDFSanitizationError("PDF could not be sanitized") from exc
    if not sanitized.startswith(b"%PDF-"):
        raise PDFSanitizationError("PDF sanitizer produced an invalid file")
    return sanitized


def sanitize_pdf_file(path: str) -> bytes:
    """Reads and sanitizes one PDF file from disk."""
    try:
        with open(path, "rb") as handle:
            return sanitize_pdf(handle.read())
    except OSError as exc:
        raise PDFSanitizationError("PDF could not be read") from exc
