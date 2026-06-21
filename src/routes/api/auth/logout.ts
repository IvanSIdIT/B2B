import { createFileRoute } from "@tanstack/react-router";

import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isSupabaseConfigured()) {
            return Response.json({ success: true }, { status: 200 });
          }

          const { supabase, applyCookies } = createSupabaseServerClient(request);
          await supabase.auth.signOut();

          const response = Response.json({ success: true }, { status: 200 });
          return applyCookies(response);
        } catch (error) {
          console.error("[auth/logout]", error);
          return Response.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
        }
      },
    },
  },
});
