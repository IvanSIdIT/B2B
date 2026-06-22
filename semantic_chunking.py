"""
Semantic text chunking via LangChain SemanticChunker.

Splits text at semantic boundaries by comparing cosine similarity between
consecutive sentence embeddings (OpenAI text-embedding-3-small).
"""

from __future__ import annotations

import os
from functools import lru_cache

from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

DEFAULT_BREAKPOINT_PERCENTILE = 85
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", "text-embedding-3-small")
MIN_TEXT_LENGTH_FOR_SEMANTIC = 80


@lru_cache(maxsize=8)
def _get_semantic_splitter(breakpoint_percentile: float) -> SemanticChunker:
    embeddings = OpenAIEmbeddings(model=EMBEDDING_MODEL)
    return SemanticChunker(
        embeddings,
        breakpoint_threshold_type="percentile",
        breakpoint_threshold_amount=breakpoint_percentile,
    )


def semantic_chunk_text(
    text: str,
    *,
    breakpoint_percentile: float = DEFAULT_BREAKPOINT_PERCENTILE,
    context_label: str = "",
) -> list[str]:
    """
    Split text into semantically coherent chunks.

  Threshold (percentile=85):
    LangChain computes cosine distances between adjacent sentence embeddings.
    Breakpoints are placed where distance exceeds the 85th percentile of all
    pairwise distances on the page — i.e. the top ~15% sharpest topic shifts.
    Lower percentile → more chunks (stricter splitting).
    Higher percentile → fewer chunks (only major topic changes).
    """
    normalized = " ".join(text.split())
    if not normalized:
        return []

    if len(normalized) < MIN_TEXT_LENGTH_FOR_SEMANTIC:
        if context_label:
            print(f"  {context_label}: korotkiy tekst -> 1 chunk")
        return [normalized]

    label_suffix = f" ({context_label})" if context_label else ""

    try:
        splitter = _get_semantic_splitter(breakpoint_percentile)
        chunks = [chunk.strip() for chunk in splitter.split_text(normalized) if chunk.strip()]

        if not chunks:
            chunks = [normalized]

        print(f"  {context_label or 'Tekst'}: vydeleno {len(chunks)} semanticheskikh chunkov")
        return chunks
    except Exception as exc:
        print(f"  Oshibka semanticheskogo chunkinga{label_suffix}: {exc}", flush=True)
        print(f"  {context_label or 'Tekst'}: fallback -> 1 chunk", flush=True)
        return [normalized]
