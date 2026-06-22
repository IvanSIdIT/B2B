import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signOut } from "@/lib/auth-client";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/worker")({
  head: () => ({
    meta: [{ title: "Worker Chat — Factory Console" }],
  }),
  component: WorkerPage,
});

type Message = { id: number; role: "worker" | "bot"; text: string };

type ChatHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

function toChatHistory(messages: Message[]): ChatHistoryEntry[] {
  return messages
    .filter((message) => message.id !== 0)
    .map((message) => ({
      role: message.role === "worker" ? "user" : "assistant",
      content: message.text,
    }));
}

function WorkerPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, role: "bot", text: "Hello. Describe the issue you are observing on the line." },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setSendError(null);

    const workerMessageId = messages.length;
    const botMessageId = messages.length + 1;
    const history = toChatHistory(messages);

    setMessages((current) => [
      ...current,
      { id: workerMessageId, role: "worker", text },
      { id: botMessageId, role: "bot", text: "…" },
    ]);
    setDraft("");

    if (isSupabaseConfigured()) {
      const { error } = await getSupabase().from("error_logs").insert({ worker_message: text });
      if (error) {
        console.error("[worker/chat] failed to save error log", error);
      }
    }

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      const data = (await response.json()) as { reply?: string; error?: string };

      if (!response.ok || !data.reply) {
        throw new Error(data.error ?? "Не удалось получить ответ от ассистента");
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === botMessageId ? { ...message, text: data.reply! } : message,
        ),
      );
    } catch (error) {
      const fallback =
        error instanceof Error ? error.message : "Не удалось получить ответ от ассистента";

      setMessages((current) =>
        current.map((message) =>
          message.id === botMessageId
            ? {
                ...message,
                text: "Не удалось связаться с ИИ-ассистентом. Сообщение сохранено, менеджер уведомлён.",
              }
            : message,
        ),
      );
      setSendError(fallback);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="text-sm font-medium text-foreground">Worker Console</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await signOut();
            navigate({ to: "/" });
          }}
        >
          Sign out
        </Button>
      </header>

      <div
        ref={scrollRef}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 overflow-y-auto px-4 py-6 sm:px-6"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "worker"
                ? "ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                : "mr-auto max-w-[80%] text-sm text-foreground"
            }
          >
            {m.text}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="border-t border-border bg-card px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {sendError ? <p className="text-sm text-destructive">{sendError}</p> : null}
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message"
              autoComplete="off"
              disabled={sending}
            />
            <Button type="submit" disabled={!draft.trim() || sending}>
              {sending ? "..." : "Send"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
