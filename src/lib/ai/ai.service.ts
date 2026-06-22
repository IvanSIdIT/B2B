import { APICallError, generateText, streamText, type ModelMessage } from "ai";

import { getAIModelName, getLanguageModel } from "./ai-provider";
import {
  type ChatCompletionOptions,
  type ChatCompletionResult,
  AIServiceError,
} from "./types";

const DEFAULT_TEMPERATURE = 0.7;

function mapAIError(error: unknown): AIServiceError {
  if (error instanceof AIServiceError) {
    return error;
  }

  if (error instanceof APICallError) {
    const status = error.statusCode ?? 502;

    if (status === 401) {
      return new AIServiceError(
        "Недействительный API-ключ OpenAI.",
        "OPENAI_INVALID_API_KEY",
        503,
      );
    }

    if (status === 429) {
      return new AIServiceError(
        "Превышен лимит запросов к OpenAI. Попробуйте позже.",
        "OPENAI_RATE_LIMIT",
        429,
      );
    }

    if (status === 400) {
      return new AIServiceError("Некорректный запрос к OpenAI.", "OPENAI_BAD_REQUEST", 400);
    }

    return new AIServiceError(
      "Ошибка при обращении к OpenAI.",
      "OPENAI_API_ERROR",
      status >= 500 ? 502 : status,
    );
  }

  console.error("[ai.service]", error);

  return new AIServiceError(
    "Не удалось получить ответ от OpenAI.",
    "OPENAI_UNKNOWN_ERROR",
    502,
  );
}

export class AIService {
  streamChat(options: {
    system: string;
    messages: ModelMessage[];
    temperature?: number;
    maxOutputTokens?: number;
    model?: string;
  }) {
    if (options.messages.length === 0) {
      throw new AIServiceError(
        "Список сообщений не может быть пустым.",
        "OPENAI_EMPTY_MESSAGES",
        400,
      );
    }

    try {
      return streamText({
        model: getLanguageModel(options.model),
        system: options.system,
        messages: options.messages,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        maxOutputTokens: options.maxOutputTokens,
        onError: ({ error }) => {
          console.error("[ai.service] stream error", error);
        },
      });
    } catch (error) {
      throw mapAIError(error);
    }
  }

  async generateChatCompletion(
    messages: ModelMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResult> {
    if (messages.length === 0) {
      throw new AIServiceError(
        "Список сообщений не может быть пустым.",
        "OPENAI_EMPTY_MESSAGES",
        400,
      );
    }

    try {
      const result = await generateText({
        model: getLanguageModel(options.model),
        messages,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        maxOutputTokens: options.maxOutputTokens,
      });

      return {
        content: result.text.trim(),
        model: result.response.modelId,
        finishReason: result.finishReason,
      };
    } catch (error) {
      throw mapAIError(error);
    }
  }
}

export const aiService = new AIService();
