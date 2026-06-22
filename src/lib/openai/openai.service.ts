import OpenAI from "openai";

import { getOpenAIClient, getOpenAIModelName } from "./openai-client";
import {
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type ChatMessage,
  OpenAIServiceError,
} from "./types";

const DEFAULT_TEMPERATURE = 0.7;

function mapOpenAIError(error: unknown): OpenAIServiceError {
  if (error instanceof OpenAIServiceError) {
    return error;
  }

  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 502;

    if (status === 401) {
      return new OpenAIServiceError(
        "Недействительный API-ключ OpenAI.",
        "OPENAI_INVALID_API_KEY",
        503,
      );
    }

    if (status === 429) {
      return new OpenAIServiceError(
        "Превышен лимит запросов к OpenAI. Попробуйте позже.",
        "OPENAI_RATE_LIMIT",
        429,
      );
    }

    if (status === 400) {
      return new OpenAIServiceError("Некорректный запрос к OpenAI.", "OPENAI_BAD_REQUEST", 400);
    }

    return new OpenAIServiceError(
      "Ошибка при обращении к OpenAI.",
      "OPENAI_API_ERROR",
      status >= 500 ? 502 : status,
    );
  }

  console.error("[openai.service]", error);

  return new OpenAIServiceError(
    "Не удалось получить ответ от OpenAI.",
    "OPENAI_UNKNOWN_ERROR",
    502,
  );
}

export class OpenAIService {
  async generateChatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResult> {
    if (messages.length === 0) {
      throw new OpenAIServiceError(
        "Список сообщений не может быть пустым.",
        "OPENAI_EMPTY_MESSAGES",
        400,
      );
    }

    try {
      const client = getOpenAIClient();
      const model = options.model ?? getOpenAIModelName();

      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: options.maxTokens,
      });

      const choice = response.choices[0];

      return {
        content: choice?.message?.content?.trim() ?? "",
        model: response.model,
        finishReason: choice?.finish_reason ?? null,
      };
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }
}

export const openaiService = new OpenAIService();
