import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { aiService, AIServiceError, isAIConfigured } from "@/lib/ai";

const testPromptSchema = z.object({
  prompt: z.string().trim().min(1, "Поле prompt обязательно"),
});

export const Route = createFileRoute("/api/ai/test-prompt")({
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

          const parsed = testPromptSchema.safeParse(body);
          if (!parsed.success) {
            const firstError = parsed.error.issues[0]?.message ?? "Некорректные данные";
            return Response.json({ error: firstError }, { status: 400 });
          }

          const result = await aiService.generateChatCompletion([
            { role: "system", content: "Ты полезный ассистент." },
            { role: "user", content: parsed.data.prompt },
          ]);

          return Response.json(
            {
              reply: result.content,
              model: result.model,
              finishReason: result.finishReason,
            },
            { status: 200 },
          );
        } catch (error) {
          if (error instanceof AIServiceError) {
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.statusCode },
            );
          }

          console.error("[api/ai/test-prompt]", error);
          return Response.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
        }
      },
    },
  },
});
