#!/usr/bin/env python3
"""
Ingest local documentation into Supabase (pgvector) for RAG.

Usage:
  pip install -r requirements-ingest.txt
  python ingest.py              # ingest docs/ (append)
  python ingest.py --replace    # clear documents table, then ingest
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from pypdf import PdfReader
from supabase import Client, create_client

DOCS_DIR = Path("docs")
SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf"}
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", "text-embedding-3-small")
BATCH_SIZE = 50


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
        print("Missing environment variables:", ", ".join(missing), file=sys.stderr)
        sys.exit(1)

    return supabase_url, service_role_key, openai_api_key


def read_file_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages).strip()

    return path.read_text(encoding="utf-8", errors="replace").strip()


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    normalized = " ".join(text.split())
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


def collect_documents(docs_dir: Path) -> list[tuple[Path, str]]:
    if not docs_dir.is_dir():
        print(f"Directory not found: {docs_dir.resolve()}", file=sys.stderr)
        sys.exit(1)

    files = sorted(
        path
        for path in docs_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )

    if not files:
        print(f"No supported files in {docs_dir.resolve()} ({', '.join(sorted(SUPPORTED_EXTENSIONS))})")
        sys.exit(0)

    documents: list[tuple[Path, str]] = []
    for path in files:
        text = read_file_text(path)
        if text:
            documents.append((path, text))
        else:
            print(f"Skipping empty file: {path}")

    return documents


def embed_texts(client: OpenAI, texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]


def clear_documents(supabase: Client) -> None:
    supabase.table("documents").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()


def ingest(replace: bool) -> None:
    supabase_url, service_role_key, openai_api_key = load_env()
    supabase = create_client(supabase_url, service_role_key)
    openai_client = OpenAI(api_key=openai_api_key)

    files = collect_documents(DOCS_DIR)
    rows: list[dict] = []

    for path, text in files:
        relative_name = str(path.relative_to(DOCS_DIR)).replace("\\", "/")
        for index, chunk in enumerate(chunk_text(text)):
            rows.append(
                {
                    "content": chunk,
                    "metadata": {
                        "source": relative_name,
                        "chunk_index": index,
                    },
                }
            )

    if not rows:
        print("No text chunks to ingest.")
        return

    if replace:
        print("Clearing existing documents...")
        clear_documents(supabase)

    print(f"Embedding {len(rows)} chunks with {EMBEDDING_MODEL}...")

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
        print(f"  inserted {min(start + BATCH_SIZE, len(rows))}/{len(rows)}")

    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest docs/ into Supabase pgvector.")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete all existing rows in documents before ingesting.",
    )
    args = parser.parse_args()
    ingest(replace=args.replace)


if __name__ == "__main__":
    main()
