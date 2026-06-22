import { useChat } from "@ai-sdk/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
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

const WELCOME_MESSAGE: UIMessage = {
  id: "welcome",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "Hello. Describe the issue you are observing on the line.",
    },
  ],
};

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function WorkerPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/ai/chat" }),
    [],
  );

  const { messages, status, sendMessage, error } = useChat({
    transport,
    messages: [WELCOME_MESSAGE],
  });

  const sending = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setDraft("");

    if (isSupabaseConfigured()) {
      const { error: saveError } = await getSupabase()
        .from("error_logs")
        .insert({ worker_message: text });

      if (saveError) {
        console.error("[worker/chat] failed to save error log", saveError);
      }
    }

    await sendMessage({ text });
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
        {messages.map((message) => {
          const text = getMessageText(message);
          const isWorker = message.role === "user";

          return (
            <div
              key={message.id}
              className={
                isWorker
                  ? "ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "mr-auto max-w-[80%] text-sm text-foreground"
              }
            >
              {text || (sending && message.role === "assistant" ? "…" : "")}
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="border-t border-border bg-card px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
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
