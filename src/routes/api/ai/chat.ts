import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";

import {
  aiService,
  AIServiceError,
  getRelevantContextText,
  isAIConfigured,
  isRagConfigured,
} from "@/lib/ai";

const RAG_MATCH_COUNT = 5;
const RAG_MATCH_THRESHOLD = 0.45;

const FALLBACK_SYSTEM_PROMPT = `Ты — ИИ-ассистент на производственной линии Factory Console.
Помогай работнику описывать неисправности, уточняй детали при необходимости.
Отвечай кратко, по делу и на русском языке.
Если проблема критична, явно укажи это и порекомендуй немедленно сообщить менеджеру.`;

function buildRagSystemPrompt(context: string): string {
  return `Ты — эксперт по техническому обслуживанию и ремонту оборудования. Отвечай на вопросы пользователя, используя ТОЛЬКО предоставленный ниже контекст из технического справочника. Если в контексте нет ответа, так и скажи, не придумывай ничего от себя. Указывай номер страницы, если он есть в контексте.

КОНТЕКСТ ДЛЯ ОТВЕТА:
${context}`;
}

const RAG_EMPTY_CONTEXT_PROMPT = `Ты — эксперт по техническому обслуживанию и ремонту оборудования. По запросу пользователя в базе знаний (Supabase / documents) не найдено релевантных фрагментов справочника. Сообщи об этом честно и не выдумывай технические детали.`;

const chatSchema = z.object({
  messages: z.array(z.custom<UIMessage>()).min(1, "История сообщений не может быть пустой"),
});

function getLastUserMessageText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;

    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }

  return "";
}

async function resolveSystemPrompt(userMessage: string): Promise<string> {
  if (!isRagConfigured()) {
    console.log("[api/ai/chat] RAG отключён: нет SUPABASE_SERVICE_ROLE_KEY или SUPABASE_URL");
    return FALLBACK_SYSTEM_PROMPT;
  }

  if (!userMessage.trim()) {
    return FALLBACK_SYSTEM_PROMPT;
  }

  try {
    const context = await getRelevantContextText(userMessage, {
      matchCount: RAG_MATCH_COUNT,
      matchThreshold: RAG_MATCH_THRESHOLD,
    });

    console.log("===> 2. Успешно извлечен контекст из Supabase (кол-во символов):", context.length);
    console.log("===> 3. Фрагмент отправляемого контекста:", context.substring(0, 300));

    if (!context.trim()) {
      console.log("===> 3b. Контекст пуст — релевантные фрагменты не найдены");
      return RAG_EMPTY_CONTEXT_PROMPT;
    }

    return buildRagSystemPrompt(context);
  } catch (error) {
    console.error("[api/ai/chat] RAG lookup failed", error);
    return FALLBACK_SYSTEM_PROMPT;
  }
}

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isAIConfigured()) {
            return Response.json(
              { error: "OpenAI не настроен. Добавьте OPENAI_API_KEY в переменные окружения." },
              { status: 503 },
            );
          }

          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return Response.json({ error: "Некорректное тело запроса" }, { status: 400 });
          }

          const parsed = chatSchema.safeParse(body);
          if (!parsed.success) {
            const firstError = parsed.error.issues[0]?.message ?? "Некорректные данные";
            return Response.json({ error: firstError }, { status: 400 });
          }

          const userMessage = getLastUserMessageText(parsed.data.messages);
          console.log("===> 1. Входящий запрос от юзера:", userMessage);

          const system = await resolveSystemPrompt(userMessage);
          console.log("===> 4. Системный промпт сформирован, длина:", system.length);

          const result = aiService.streamChat({
            system,
            messages: await convertToModelMessages(parsed.data.messages),
            model: "gpt-4o",
          });

          console.log("===> 5. Запуск streamText (GPT-4o)...");

          return result.toUIMessageStreamResponse({
            onError: (error) => {
              console.error("[api/ai/chat] stream error", error);
              return "Не удалось завершить генерацию ответа.";
            },
          });
        } catch (error) {
          if (error instanceof AIServiceError) {
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.statusCode },
            );
          }

          console.error("[api/ai/chat]", error);
          return Response.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
        }
      },
    },
  },
});
