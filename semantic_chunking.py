"""
Semantic chunking for technical PDF text (figure captions, specifications).

Pre-splits by paragraphs/lines (not naive sentence dots), then groups units by
embedding similarity with gradient threshold and min-chunk merging.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import Literal

import numpy as np
from langchain_community.utils.math import cosine_similarity
from langchain_openai import OpenAIEmbeddings

BreakpointThresholdType = Literal["percentile", "gradient", "standard_deviation", "interquartile"]

DEFAULT_BREAKPOINT_TYPE: BreakpointThresholdType = "gradient"
DEFAULT_BREAKPOINT_AMOUNT = 90
DEFAULT_MIN_CHUNK_SIZE = 180
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", "text-embedding-3-small")
MIN_UNIT_LENGTH = 2

FIGURE_START_RE = re.compile(
    r"^(?:Рис\.?|рис\.?|Табл\.?|табл\.?|РИС\.?|ТАБЛ\.?)\s",
    re.IGNORECASE | re.UNICODE,
)
SPEC_ITEM_RE = re.compile(
    r"^\d+\s*[–—\-]\s*\S",
    re.UNICODE,
)
FIGURE_REF_RE = re.compile(r"(?:Рис\.?|Табл\.?|рис\.?|табл\.?)\s", re.IGNORECASE | re.UNICODE)


@lru_cache(maxsize=1)
def _get_embeddings() -> OpenAIEmbeddings:
    return OpenAIEmbeddings(model=EMBEDDING_MODEL)


def presplit_technical_units(text: str) -> list[str]:
    """
    Split page text into logical units before semantic comparison.

    - Prefer paragraph / line boundaries from PDF extraction.
    - Keep figure captions ("Рис. Д-15.2 ... 16 – втулка") as single units.
    """
    stripped = text.strip()
    if not stripped:
        return []

    blocks = re.split(r"\n\s*\n+", stripped)
    units: list[str] = []

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) <= 1:
            units.extend(_split_oversized_unit(block))
            continue

        units.extend(_merge_figure_and_paragraph_lines(lines))

    if not units:
        lines = [line.strip() for line in stripped.splitlines() if line.strip()]
        if lines:
            units.extend(_merge_figure_and_paragraph_lines(lines))

    return [unit for unit in units if len(unit) >= MIN_UNIT_LENGTH]


def _merge_figure_and_paragraph_lines(lines: list[str]) -> list[str]:
    units: list[str] = []
    buffer: list[str] = []
    in_figure_block = False

    def flush() -> None:
        nonlocal buffer, in_figure_block
        if buffer:
            merged = " ".join(buffer)
            units.extend(_split_oversized_unit(merged))
            buffer = []
        in_figure_block = False

    for line in lines:
        is_figure_start = bool(FIGURE_START_RE.match(line))
        is_spec_line = bool(SPEC_ITEM_RE.match(line))
        has_figure_ref = bool(FIGURE_REF_RE.search(line))

        if is_figure_start:
            flush()
            buffer = [line]
            in_figure_block = True
            continue

        if in_figure_block and (is_spec_line or _is_figure_continuation(line)):
            buffer.append(line)
            continue

        if has_figure_ref and (";" in line or "–" in line or "—" in line or "-" in line):
            flush()
            units.extend(_split_oversized_unit(line))
            continue

        if buffer:
            if _should_merge_with_buffer(buffer, line):
                buffer.append(line)
            else:
                flush()
                buffer = [line]
        else:
            buffer = [line]

    flush()
    return units


def _is_figure_continuation(line: str) -> bool:
    if SPEC_ITEM_RE.match(line):
        return True
    if re.match(r"^\d+[,.]\d*", line):
        return True
    if line.startswith(";"):
        return True
    if ";" in line and len(line) < 240:
        return True
    return False


def _should_merge_with_buffer(buffer: list[str], line: str) -> bool:
    if FIGURE_START_RE.match(line):
        return False
    if FIGURE_START_RE.match(buffer[0]):
        return _is_figure_continuation(line) or bool(SPEC_ITEM_RE.match(line))

    combined_len = len(" ".join(buffer + [line]))
    return combined_len <= 900


def _split_oversized_unit(unit: str, max_len: int = 1800) -> list[str]:
    """Split very long units on semicolons or safe boundaries only."""
    unit = " ".join(unit.split())
    if len(unit) <= max_len:
        return [unit]

    parts = re.split(r"(?<=[;])\s+", unit)
    if len(parts) == 1:
        return [unit]

    chunks: list[str] = []
    current = ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        candidate = f"{current} {part}".strip() if current else part
        if len(candidate) > max_len and current:
            chunks.append(current)
            current = part
        else:
            current = candidate

    if current:
        chunks.append(current)

    return chunks or [unit]


def _calculate_breakpoint_threshold(
    distances: list[float],
    threshold_type: BreakpointThresholdType,
    threshold_amount: float,
) -> float:
    if not distances:
        return 1.0

    if threshold_type == "percentile":
        return float(np.percentile(distances, threshold_amount))

    if threshold_type == "gradient":
        gradient = np.gradient(distances, range(len(distances)))
        return float(np.percentile(gradient, threshold_amount))

    if threshold_type == "standard_deviation":
        return float(np.mean(distances) + threshold_amount * np.std(distances))

    if threshold_type == "interquartile":
        q1, q3 = np.percentile(distances, [25, 75])
        iqr = q3 - q1
        return float(np.mean(distances) + threshold_amount * iqr)

    raise ValueError(f"Unsupported threshold type: {threshold_type}")


def _semantic_merge_units(
    units: list[str],
    threshold_type: BreakpointThresholdType,
    threshold_amount: float,
    buffer_size: int = 1,
) -> list[str]:
    if len(units) == 1:
        return units

    sentences = [{"sentence": unit, "index": index} for index, unit in enumerate(units)]

    for index in range(len(sentences)):
        combined = ""
        for offset in range(index - buffer_size, index):
            if offset >= 0:
                combined += sentences[offset]["sentence"] + " "
        combined += sentences[index]["sentence"]
        for offset in range(index + 1, index + 1 + buffer_size):
            if offset < len(sentences):
                combined += " " + sentences[offset]["sentence"]
        sentences[index]["combined_sentence"] = combined.strip()

    embeddings = _get_embeddings().embed_documents(
        [entry["combined_sentence"] for entry in sentences]
    )

    distances: list[float] = []
    for index in range(len(sentences) - 1):
        similarity = cosine_similarity(
            [embeddings[index]],
            [embeddings[index + 1]],
        )[0][0]
        distances.append(1 - similarity)

    if threshold_type == "gradient" and len(distances) == 1:
        return [" ".join(units)]

    if threshold_type == "gradient":
        gradient = np.gradient(distances, range(len(distances)))
        threshold = float(np.percentile(gradient, threshold_amount))
        breakpoint_flags = [value > threshold for value in gradient]
    else:
        threshold = _calculate_breakpoint_threshold(distances, threshold_type, threshold_amount)
        breakpoint_flags = [distance > threshold for distance in distances]

    chunks: list[str] = []
    start = 0
    for index, is_break in enumerate(breakpoint_flags):
        if is_break:
            chunks.append(" ".join(units[start : index + 1]))
            start = index + 1

    if start < len(units):
        chunks.append(" ".join(units[start:]))

    return [chunk.strip() for chunk in chunks if chunk.strip()]


def merge_micro_chunks(chunks: list[str], min_size: int = DEFAULT_MIN_CHUNK_SIZE) -> list[str]:
    if not chunks:
        return []

    merged: list[str] = []
    for chunk in chunks:
        piece = " ".join(chunk.split())
        if not piece:
            continue

        if merged and len(piece) < min_size:
            merged[-1] = f"{merged[-1]} {piece}".strip()
        elif merged and len(merged[-1]) < min_size:
            merged[-1] = f"{merged[-1]} {piece}".strip()
        else:
            merged.append(piece)

    if len(merged) >= 2 and len(merged[-1]) < min_size:
        merged[-2] = f"{merged[-2]} {merged.pop()}".strip()

    return merged


def semantic_chunk_text(
    text: str,
    *,
    breakpoint_threshold_type: BreakpointThresholdType = DEFAULT_BREAKPOINT_TYPE,
    breakpoint_threshold_amount: float = DEFAULT_BREAKPOINT_AMOUNT,
    breakpoint_percentile: float | None = None,
    min_chunk_size: int = DEFAULT_MIN_CHUNK_SIZE,
    context_label: str = "",
) -> list[str]:
    """
    Semantic chunking with technical pre-splitting.

    Threshold (gradient=90 by default):
      Uses the gradient of cosine distances between logical units.
      Higher amount -> fewer breakpoints -> larger chunks (good for spec lists).
      For percentile mode, use breakpoint_threshold_type='percentile' and amount ~90.
    """
    if breakpoint_percentile is not None:
        breakpoint_threshold_type = "percentile"
        breakpoint_threshold_amount = breakpoint_percentile

    units = presplit_technical_units(text)
    if not units:
        return []

    label = context_label or "Tekst"

    if len(units) == 1:
        chunks = merge_micro_chunks(units, min_chunk_size)
        print(f"  {label}: 1 logical unit -> {len(chunks)} chunk(s)")
        return chunks

    try:
        raw_chunks = _semantic_merge_units(
            units,
            breakpoint_threshold_type,
            breakpoint_threshold_amount,
        )
        chunks = merge_micro_chunks(raw_chunks, min_chunk_size)

        if not chunks:
            chunks = merge_micro_chunks([" ".join(units)], min_chunk_size)

        print(
            f"  {label}: {len(units)} logical units -> "
            f"{len(chunks)} semantic chunk(s) "
            f"(threshold={breakpoint_threshold_type}:{breakpoint_threshold_amount})"
        )
        return chunks
    except Exception as exc:
        print(f"  Semantic chunking error ({label}): {exc}", flush=True)
        fallback = merge_micro_chunks([" ".join(units)], min_chunk_size)
        print(f"  {label}: fallback -> {len(fallback)} chunk(s)", flush=True)
        return fallback
