import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";

import { aiService, AIServiceError, isAIConfigured } from "@/lib/ai";

const FACTORY_ASSISTANT_PROMPT = `Ты — ИИ-ассистент на производственной линии Factory Console.
Помогай работнику описывать неисправности, уточняй детали при необходимости.
Отвечай кратко, по делу и на русском языке.
Если проблема критична, явно укажи это и порекомендуй немедленно сообщить менеджеру.`;

const chatSchema = z.object({
  messages: z.array(z.custom<UIMessage>()).min(1, "История сообщений не может быть пустой"),
});

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

          const result = aiService.streamChat({
            system: FACTORY_ASSISTANT_PROMPT,
            messages: await convertToModelMessages(parsed.data.messages),
            model: "gpt-4o",
          });

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
