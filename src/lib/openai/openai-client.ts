import OpenAI from "openai";

import { OpenAIServiceError } from "./types";

const DEFAULT_MODEL = "gpt-4o";

export function getOpenAIModelName(): string {
  return process.env.OPENAI_MODEL_NAME ?? DEFAULT_MODEL;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new OpenAIServiceError(
      "OpenAI API key is not configured. Set OPENAI_API_KEY in your environment.",
      "OPENAI_NOT_CONFIGURED",
      503,
    );
  }

  if (!client) {
    client = new OpenAI({ apiKey });
  }

  return client;
}

export function resetOpenAIClientForTests(): void {
  client = null;
}
