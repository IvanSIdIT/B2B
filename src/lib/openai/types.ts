export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatCompletionOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  finishReason: string | null;
};

export class OpenAIServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = "OpenAIServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
