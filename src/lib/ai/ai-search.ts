import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";

import { readServerEnv } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_MATCH_COUNT = 5;
const DEFAULT_MATCH_THRESHOLD = 0.5;

export type DocumentMatch = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

export function isRagConfigured(): boolean {
  const url = readServerEnv("SUPABASE_URL") || readServerEnv("VITE_SUPABASE_URL");
  return Boolean(url && readServerEnv("SUPABASE_SERVICE_ROLE_KEY") && readServerEnv("OPENAI_API_KEY"));
}

function getEmbeddingModelName(): string {
  return readServerEnv("EMBEDDING_MODEL_NAME") || DEFAULT_EMBEDDING_MODEL;
}

export async function embedQuery(userQuery: string): Promise<number[]> {
  const apiKey = readServerEnv("OPENAI_API_KEY");

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const openai = createOpenAI({ apiKey });
  const { embedding } = await embed({
    model: openai.embedding(getEmbeddingModelName()),
    value: userQuery,
  });

  return embedding;
}

export async function getRelevantContext(
  userQuery: string,
  options: {
    matchCount?: number;
    matchThreshold?: number;
  } = {},
): Promise<DocumentMatch[]> {
  const query = userQuery.trim();

  if (!query) {
    return [];
  }

  const embedding = await embedQuery(query);
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_threshold: options.matchThreshold ?? DEFAULT_MATCH_THRESHOLD,
    match_count: options.matchCount ?? DEFAULT_MATCH_COUNT,
  });

  if (error) {
    throw new Error(`match_documents failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    content: row.content,
    metadata: row.metadata as Record<string, unknown> | null,
    similarity: row.similarity,
  }));
}

export function formatContextForPrompt(matches: DocumentMatch[]): string {
  if (matches.length === 0) {
    return "";
  }

  return matches
    .map((match, index) => {
      const source =
        typeof match.metadata?.source === "string" ? match.metadata.source : "unknown";
      const page =
        typeof match.metadata?.page === "number" ? `, стр. ${match.metadata.page}` : "";
      return `[${index + 1}] (${source}${page}, similarity: ${match.similarity.toFixed(3)})\n${match.content}`;
    })
    .join("\n\n");
}
