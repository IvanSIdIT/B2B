import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  isOpenAIConfigured,
  openaiService,
  OpenAIServiceError,
  type ChatMessage,
} from "@/lib/openai";

const FACTORY_ASSISTANT_PROMPT = `Ты — ИИ-ассистент на производственной линии Factory Console.
Помогай работнику описывать неисправности, уточняй детали при необходимости.
Отвечай кратко, по делу и на русском языке.
Если проблема критична, явно укажи это и порекомендуй немедленно сообщить менеджеру.`;

const chatSchema = z.object({
  message: z.string().trim().min(1, "Сообщение не может быть пустым"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .optional()
    .default([]),
});

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isOpenAIConfigured()) {
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

          const messages: ChatMessage[] = [
            { role: "system", content: FACTORY_ASSISTANT_PROMPT },
            ...parsed.data.history.map((entry) => ({
              role: entry.role,
              content: entry.content,
            })),
            { role: "user", content: parsed.data.message },
          ];

          const result = await openaiService.generateChatCompletion(messages, {
            model: "gpt-4o",
          });

          return Response.json(
            {
              reply: result.content,
              model: result.model,
              finishReason: result.finishReason,
            },
            { status: 200 },
          );
        } catch (error) {
          if (error instanceof OpenAIServiceError) {
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
