#!/usr/bin/env python3
"""
Ingest ZOV.pdf into Supabase (pgvector) with technical semantic chunking.

Preserves figure captions as single logical units before embedding similarity split.
Always clears the documents table before import.

Usage:
  pip install -r requirements-ingest.txt
  python ingest.py
  python ingest.py --threshold-amount 92
  python ingest.py --threshold-type percentile --threshold-amount 90
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter
from pathlib import Path

import fitz  # PyMuPDF
from dotenv import load_dotenv
from openai import OpenAI
from supabase import Client, create_client

from semantic_chunking import (
    DEFAULT_BREAKPOINT_AMOUNT,
    DEFAULT_BREAKPOINT_TYPE,
    DEFAULT_MIN_CHUNK_SIZE,
    semantic_chunk_text,
)

PDF_PATH = Path(r"C:\Users\sidel\Desktop\ZOV.pdf")
SOURCE_NAME = "ZOV.pdf"

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", "text-embedding-3-small")
BATCH_SIZE = 50

PAGE_NUMBER_ONLY_RE = re.compile(r"^\d{1,4}$")
PAGE_LABEL_RE = re.compile(r"^(стр\.?|page|с\.)\s*\d{1,4}\.?$", re.IGNORECASE)


def load_env() -> tuple[str, str, str]:
    load_dotenv()

    supabase_url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    openai_api_key = os.getenv("OPENAI_API_KEY") or ""

    missing = []
    if not supabase_url:
        missing.append("SUPABASE_URL (or VITE_SUPABASE_URL)")
    if not service_role_key:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not openai_api_key:
        missing.append("OPENAI_API_KEY")

    if missing:
        print("Не заданы переменные окружения:", ", ".join(missing), file=sys.stderr)
        sys.exit(1)

    return supabase_url, service_role_key, openai_api_key


def detect_repeated_edge_lines(raw_pages: list[str], edge: str) -> set[str]:
    counter: Counter[str] = Counter()

    for page_text in raw_pages:
        lines = [line.strip() for line in page_text.splitlines() if line.strip()]
        if not lines:
            continue

        candidates = lines[:2] if edge == "header" else lines[-2:]
        for line in candidates:
            if len(line) >= 8:
                counter[line] += 1

    threshold = max(5, int(len(raw_pages) * 0.35))
    return {line for line, count in counter.items() if count >= threshold}


def clean_page_text(
    text: str,
    page_num: int,
    header_lines: set[str],
    footer_lines: set[str],
) -> str:
    """Keep line breaks so figure captions stay grouped during pre-splitting."""
    cleaned_lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        if stripped in header_lines or stripped in footer_lines:
            continue

        if PAGE_NUMBER_ONLY_RE.match(stripped) and int(stripped) == page_num:
            continue

        if PAGE_LABEL_RE.match(stripped):
            continue

        cleaned_lines.append(stripped)

    return "\n".join(cleaned_lines)


def extract_pdf_pages(pdf_path: Path) -> list[tuple[int, str]]:
    if not pdf_path.is_file():
        print(f"PDF не найден: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[1/4] Чтение PDF: {pdf_path}")

    doc = fitz.open(pdf_path)
    total_pages = doc.page_count
    print(f"      Файл: {pdf_path.name}, страниц: {total_pages}")

    raw_pages: list[str] = []
    for page_index in range(total_pages):
        page = doc.load_page(page_index)
        raw_pages.append(page.get_text("text") or "")

    header_lines = detect_repeated_edge_lines(raw_pages, "header")
    footer_lines = detect_repeated_edge_lines(raw_pages, "footer")

    if header_lines or footer_lines:
        print(
            f"      Удаление колонтитулов: верхних — {len(header_lines)}, "
            f"нижних — {len(footer_lines)}"
        )

    pages: list[tuple[int, str]] = []
    for page_index, raw_text in enumerate(raw_pages, start=1):
        cleaned = clean_page_text(raw_text, page_index, header_lines, footer_lines)
        if cleaned:
            pages.append((page_index, cleaned))

        if page_index % 10 == 0 or page_index == total_pages:
            print(f"      Обработано страниц: {page_index}/{total_pages}")

    doc.close()
    print(f"      Извлечено страниц с текстом: {len(pages)}/{total_pages}")
    return pages


def build_semantic_chunk_rows(
    pages: list[tuple[int, str]],
    *,
    threshold_type: str,
    threshold_amount: float,
    min_chunk_size: int,
) -> list[dict]:
    rows: list[dict] = []
    total_semantic_chunks = 0

    print(
        f"[2/4] Семантическое дробление "
        f"(type={threshold_type}, amount={threshold_amount}, "
        f"min_chunk={min_chunk_size}, model={EMBEDDING_MODEL})"
    )

    for page_num, page_text in pages:
        label = f"{SOURCE_NAME}, стр. {page_num}"
        page_chunks = semantic_chunk_text(
            page_text,
            breakpoint_threshold_type=threshold_type,  # type: ignore[arg-type]
            breakpoint_threshold_amount=threshold_amount,
            min_chunk_size=min_chunk_size,
            context_label=label,
        )
        total_semantic_chunks += len(page_chunks)

        for chunk_index, chunk in enumerate(page_chunks):
            rows.append(
                {
                    "content": chunk,
                    "metadata": {
                        "source": SOURCE_NAME,
                        "page": page_num,
                        "chunk_index": chunk_index,
                        "file": PDF_PATH.name,
                        "chunking": "semantic_technical",
                    },
                }
            )

    print(f"      Итого семантических чанков: {total_semantic_chunks}")
    return rows


def embed_texts(client: OpenAI, texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]


def clear_documents(supabase: Client) -> None:
    print("[3/4] Очистка таблицы documents (удаление старых чанков)...")
    supabase.table("documents").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("      Таблица documents очищена.")


def upload_chunks(
    supabase: Client,
    openai_client: OpenAI,
    rows: list[dict],
) -> int:
    print(f"[4/4] Генерация эмбеддингов и загрузка в Supabase ({len(rows)} чанков)...")

    saved = 0
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        embeddings = embed_texts(openai_client, [row["content"] for row in batch])

        payload = [
            {
                "content": row["content"],
                "metadata": row["metadata"],
                "embedding": embedding,
            }
            for row, embedding in zip(batch, embeddings, strict=True)
        ]

        supabase.table("documents").insert(payload).execute()
        saved += len(payload)
        print(f"      Сохранено в Supabase: {saved}/{len(rows)}")

    return saved


def ingest(
    threshold_type: str,
    threshold_amount: float,
    min_chunk_size: int,
) -> None:
    supabase_url, service_role_key, openai_api_key = load_env()
    supabase = create_client(supabase_url, service_role_key)
    openai_client = OpenAI(api_key=openai_api_key)

    pages = extract_pdf_pages(PDF_PATH)
    rows = build_semantic_chunk_rows(
        pages,
        threshold_type=threshold_type,
        threshold_amount=threshold_amount,
        min_chunk_size=min_chunk_size,
    )

    if not rows:
        print("Текст не извлечён — загрузка отменена.")
        return

    clear_documents(supabase)
    saved = upload_chunks(supabase, openai_client, rows)

    print(f"Готово. Успешно сохранено семантических чанков в Supabase: {saved}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Полная перезапись RAG-базы из ZOV.pdf (technical semantic chunking).",
    )
    parser.add_argument(
        "--threshold-type",
        choices=["gradient", "percentile", "standard_deviation", "interquartile"],
        default=DEFAULT_BREAKPOINT_TYPE,
        help="Метод порога разрыва (по умолчанию gradient — мягче для списков деталей).",
    )
    parser.add_argument(
        "--threshold-amount",
        type=float,
        default=DEFAULT_BREAKPOINT_AMOUNT,
        help=(
            "Чувствительность порога (по умолчанию 90). "
            "Больше — меньше разрезов и крупнее чанки."
        ),
    )
    parser.add_argument(
        "--min-chunk-size",
        type=int,
        default=DEFAULT_MIN_CHUNK_SIZE,
        help="Минимальный размер чанка в символах (микро-чанки склеиваются).",
    )
    args = parser.parse_args()
    ingest(
        threshold_type=args.threshold_type,
        threshold_amount=args.threshold_amount,
        min_chunk_size=args.min_chunk_size,
    )


if __name__ == "__main__":
    main()
