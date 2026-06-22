import type { ModelMessage } from "ai";

export type ChatMessage = ModelMessage;

export type ChatCompletionOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  finishReason: string | null;
};

export class AIServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
