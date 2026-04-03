from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET
import re


PRESENTATION_NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


def extract_pptx_text(path: Path) -> str:
    slides: list[tuple[int, str]] = []
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(
            name
            for name in archive.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )

        for name in slide_names:
            slide_number = int(name.rsplit("slide", 1)[1].split(".xml", 1)[0])
            root = ET.fromstring(archive.read(name))
            pieces = [
                (text.text or "").strip()
                for text in root.findall(".//a:t", PRESENTATION_NS)
                if (text.text or "").strip()
            ]
            slides.append((slide_number, "\n".join(pieces)))

    return "\n\n".join(
        f"[Slide {slide_number}]\n{content}" for slide_number, content in slides
    )


def _safe_pdf_extract(path: Path) -> Iterable[str]:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:  # pragma: no cover - environment specific
        raise RuntimeError(f"pypdf is unavailable: {exc}") from exc

    reader = PdfReader(str(path))
    for page_index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        yield f"[Page {page_index}]\n{text}"


def extract_pdf_text(path: Path) -> str:
    return "\n\n".join(_safe_pdf_extract(path))


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def resolve_target(raw_path: str) -> Path:
    target = Path(raw_path)
    if target.exists():
        return target

    parent = target.parent
    if not parent.exists():
        return target

    expected = _normalize_name(target.name)
    for candidate in parent.iterdir():
        if _normalize_name(candidate.name) == expected:
            return candidate

    stem_tokens = [token for token in re.split(r"[^a-z0-9]+", target.stem.casefold()) if token]
    for candidate in parent.iterdir():
        normalized = candidate.name.casefold()
        if all(token in normalized for token in stem_tokens):
            return candidate

    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["pptx", "pdf"])
    parser.add_argument("path", nargs="+")
    args = parser.parse_args()

    target = resolve_target(" ".join(args.path))
    if not target.exists():
        print(f"Missing file: {target}", file=sys.stderr)
        return 1

    if args.kind == "pptx":
        text = extract_pptx_text(target)
    else:
        text = extract_pdf_text(target)

    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
