import OpenAI from "openai";

import { readServerEnv } from "@/lib/server-env";

import { OpenAIServiceError } from "./types";

const DEFAULT_MODEL = "gpt-4o";
const API_KEY_ENV = "OPENAI_API_KEY";
const MODEL_ENV = "OPENAI_MODEL_NAME";

export function getOpenAIModelName(): string {
  return readServerEnv(MODEL_ENV) || DEFAULT_MODEL;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(readServerEnv(API_KEY_ENV));
}

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = readServerEnv(API_KEY_ENV);

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
