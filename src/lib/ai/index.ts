export {
  embedQuery,
  formatContextForPrompt,
  getRelevantContext,
  getRelevantContextText,
  isRagConfigured,
  type DocumentMatch,
} from "./ai-search";
export { getAIModelName, getLanguageModel, isAIConfigured, resetAIProviderForTests } from "./ai-provider";
export { AIService, aiService } from "./ai.service";
export {
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type ChatMessage,
  AIServiceError,
} from "./types";
