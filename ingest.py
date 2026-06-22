#!/usr/bin/env python3
"""
Ingest ZOV.pdf into Supabase (pgvector) via LlamaParse + semantic chunking.

LlamaParse extracts tables and figure captions as Markdown; semantic chunking
preserves those blocks before embedding upload.

Usage:
  pip install -r requirements-ingest.txt
  python ingest.py
  python ingest.py --threshold-amount 92
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import nest_asyncio
from dotenv import load_dotenv
from llama_parse import LlamaParse
from openai import OpenAI
from supabase import Client, create_client

from semantic_chunking import (
    DEFAULT_BREAKPOINT_AMOUNT,
    DEFAULT_BREAKPOINT_TYPE,
    DEFAULT_MIN_CHUNK_SIZE,
    semantic_chunk_text,
)

nest_asyncio.apply()

PDF_PATH = Path(r"C:\Users\sidel\Desktop\ZOV.pdf")
SOURCE_NAME = "ZOV.pdf"

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", "text-embedding-3-small")
BATCH_SIZE = 50


def load_env() -> tuple[str, str, str, str]:
    load_dotenv()

    supabase_url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    openai_api_key = os.getenv("OPENAI_API_KEY") or ""
    llama_api_key = os.getenv("LLAMA_CLOUD_API_KEY") or ""

    missing = []
    if not supabase_url:
        missing.append("SUPABASE_URL (or VITE_SUPABASE_URL)")
    if not service_role_key:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not openai_api_key:
        missing.append("OPENAI_API_KEY")
    if not llama_api_key:
        missing.append("LLAMA_CLOUD_API_KEY")

    if missing:
        print("Не заданы переменные окружения:", ", ".join(missing), file=sys.stderr)
        sys.exit(1)

    return supabase_url, service_role_key, openai_api_key, llama_api_key


def _document_text(document: object) -> str:
    if hasattr(document, "text") and document.text:
        return str(document.text)
    if hasattr(document, "get_content"):
        return str(document.get_content())
    return str(document)


def _document_page_number(document: object, fallback: int) -> int:
    metadata = getattr(document, "metadata", None) or {}
    if not isinstance(metadata, dict):
        return fallback

    for key in ("page_label", "page_number", "page"):
        value = metadata.get(key)
        if value is None:
            continue
        try:
            return int(str(value).strip())
        except ValueError:
            continue

    return fallback


def extract_pdf_pages_llamaparse(pdf_path: Path, llama_api_key: str) -> list[tuple[int, str]]:
    if not pdf_path.is_file():
        print(f"PDF не найден: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[1/4] Парсинг PDF через LlamaParse (markdown): {pdf_path}")
    print("      Это может занять несколько минут для больших файлов...")

    parser = LlamaParse(
        api_key=llama_api_key,
        result_type="markdown",
        num_workers=4,
        verbose=True,
    )

    documents = parser.load_data(str(pdf_path))
    pages: list[tuple[int, str]] = []

    for index, document in enumerate(documents, start=1):
        text = _document_text(document).strip()
        if not text:
            continue

        page_num = _document_page_number(document, index)
        pages.append((page_num, text))

        if index % 10 == 0 or index == len(documents):
            print(f"      Обработано документов LlamaParse: {index}/{len(documents)}")

    print(f"      Извлечено страниц с текстом: {len(pages)}")
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
        f"[2/4] Семантическое дробление Markdown "
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
                        "chunking": "semantic_llamaparse",
                        "parser": "llama-parse",
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
    supabase_url, service_role_key, openai_api_key, llama_api_key = load_env()
    supabase = create_client(supabase_url, service_role_key)
    openai_client = OpenAI(api_key=openai_api_key)

    pages = extract_pdf_pages_llamaparse(PDF_PATH, llama_api_key)
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
        description="Полная перезапись RAG-базы из ZOV.pdf (LlamaParse + semantic chunking).",
    )
    parser.add_argument(
        "--threshold-type",
        choices=["gradient", "percentile", "standard_deviation", "interquartile"],
        default=DEFAULT_BREAKPOINT_TYPE,
        help="Метод порога разрыва (по умолчанию gradient).",
    )
    parser.add_argument(
        "--threshold-amount",
        type=float,
        default=DEFAULT_BREAKPOINT_AMOUNT,
        help="Чувствительность порога (больше — крупнее чанки).",
    )
    parser.add_argument(
        "--min-chunk-size",
        type=int,
        default=DEFAULT_MIN_CHUNK_SIZE,
        help="Минимальный размер чанка в символах.",
    )
    args = parser.parse_args()
    ingest(
        threshold_type=args.threshold_type,
        threshold_amount=args.threshold_amount,
        min_chunk_size=args.min_chunk_size,
    )


if __name__ == "__main__":
    main()
