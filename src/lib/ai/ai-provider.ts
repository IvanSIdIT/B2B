import { createOpenAI } from "@ai-sdk/openai";

import { readServerEnv } from "@/lib/server-env";

import { AIServiceError } from "./types";

const DEFAULT_MODEL = "gpt-4o";
const API_KEY_ENV = "OPENAI_API_KEY";
const MODEL_ENV = "OPENAI_MODEL_NAME";

export function getAIModelName(): string {
  return readServerEnv(MODEL_ENV) || DEFAULT_MODEL;
}

export function isAIConfigured(): boolean {
  return Boolean(readServerEnv(API_KEY_ENV));
}

let provider: ReturnType<typeof createOpenAI> | null = null;

function getOpenAIProvider() {
  const apiKey = readServerEnv(API_KEY_ENV);

  if (!apiKey) {
    throw new AIServiceError(
      "OpenAI API key is not configured. Set OPENAI_API_KEY in your environment.",
      "OPENAI_NOT_CONFIGURED",
      503,
    );
  }

  if (!provider) {
    provider = createOpenAI({ apiKey });
  }

  return provider;
}

export function getLanguageModel(model?: string) {
  return getOpenAIProvider()(model ?? getAIModelName());
}

export function resetAIProviderForTests(): void {
  provider = null;
}
