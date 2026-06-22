#!/usr/bin/env python3
"""
Ingest the TOiKR reference PDF into Supabase (pgvector) for RAG.

Usage:
  pip install -r requirements-ingest.txt
  python ingest_pdf.py
  python ingest_pdf.py --replace
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

PDF_PATH = Path(r"C:\Users\sidel\Desktop\Spravochnik_po_TOiKR_obschepromysh-52657.pdf")
SOURCE_NAME = "Spravochnik_po_TOiKR"

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
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


def normalize_whitespace(text: str) -> str:
    return " ".join(text.split())


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
    cleaned_lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        if stripped in header_lines or stripped in footer_lines:
            continue

        if PAGE_NUMBER_ONLY_RE.match(stripped):
            if int(stripped) == page_num:
                continue

        if PAGE_LABEL_RE.match(stripped):
            continue

        cleaned_lines.append(stripped)

    return normalize_whitespace(" ".join(cleaned_lines))


def extract_pdf_pages(pdf_path: Path) -> list[tuple[int, str]]:
    if not pdf_path.is_file():
        print(f"PDF не найден: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    doc = fitz.open(pdf_path)
    total_pages = doc.page_count
    print(f"Открыт PDF: {pdf_path.name} ({total_pages} стр.)")

    raw_pages: list[str] = []
    for page_index in range(total_pages):
        page = doc.load_page(page_index)
        raw_pages.append(page.get_text("text") or "")

    header_lines = detect_repeated_edge_lines(raw_pages, "header")
    footer_lines = detect_repeated_edge_lines(raw_pages, "footer")

    if header_lines or footer_lines:
        print(
            f"Обнаружено повторяющихся колонтитулов: "
            f"верхних — {len(header_lines)}, нижних — {len(footer_lines)}"
        )

    pages: list[tuple[int, str]] = []
    for page_index, raw_text in enumerate(raw_pages, start=1):
        cleaned = clean_page_text(raw_text, page_index, header_lines, footer_lines)
        if cleaned:
            pages.append((page_index, cleaned))

        if page_index % 10 == 0 or page_index == total_pages:
            print(f"Обработано страниц: {page_index}/{total_pages}...")

    doc.close()
    return pages


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    normalized = normalize_whitespace(text)
    if not normalized:
        return []

    if len(normalized) <= chunk_size:
        return [normalized]

    chunks: list[str] = []
    start = 0

    while start < len(normalized):
        end = start + chunk_size
        piece = normalized[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(normalized):
            break
        start = max(end - overlap, start + 1)

    return chunks


def build_chunk_rows(pages: list[tuple[int, str]]) -> list[dict]:
    rows: list[dict] = []
    previous_tail = ""

    for page_num, page_text in pages:
        combined = f"{previous_tail} {page_text}".strip() if previous_tail else page_text
        page_chunks = chunk_text(combined)

        for chunk_index, chunk in enumerate(page_chunks):
            rows.append(
                {
                    "content": chunk,
                    "metadata": {
                        "source": SOURCE_NAME,
                        "page": page_num,
                        "chunk_index": chunk_index,
                        "file": PDF_PATH.name,
                    },
                }
            )

        previous_tail = page_text[-CHUNK_OVERLAP:] if len(page_text) > CHUNK_OVERLAP else page_text

    return rows


def embed_texts(client: OpenAI, texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]


def clear_documents(supabase: Client) -> None:
    supabase.table("documents").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()


def ingest_pdf(replace: bool) -> None:
    supabase_url, service_role_key, openai_api_key = load_env()
    supabase = create_client(supabase_url, service_role_key)
    openai_client = OpenAI(api_key=openai_api_key)

    pages = extract_pdf_pages(PDF_PATH)
    rows = build_chunk_rows(pages)

    if not rows:
        print("Текст не извлечён — чанки для загрузки отсутствуют.")
        return

    print(f"Подготовлено чанков: {len(rows)} (размер ~{CHUNK_SIZE} симв., overlap {CHUNK_OVERLAP})")

    if replace:
        print("Очистка таблицы documents...")
        clear_documents(supabase)

    saved = 0
    print(f"Генерация эмбеддингов ({EMBEDDING_MODEL}) и загрузка в Supabase...")

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
        print(f"  Сохранено чанков: {saved}/{len(rows)}")

    print(f"Готово. Успешно сохранено чанков в Supabase: {saved}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Загрузить справочник TOiKR (PDF) в Supabase pgvector.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Удалить все существующие строки в documents перед загрузкой.",
    )
    args = parser.parse_args()
    ingest_pdf(replace=args.replace)


if __name__ == "__main__":
    main()
