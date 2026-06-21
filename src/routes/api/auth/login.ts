import { createFileRoute } from "@tanstack/react-router";

import { getRedirectForRole, loginSchema, mapAuthError, toAuthUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isSupabaseConfigured()) {
            return Response.json({ error: "Supabase не настроен на сервере" }, { status: 503 });
          }

          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return Response.json({ error: "Некорректное тело запроса" }, { status: 400 });
          }

          const parsed = loginSchema.safeParse(body);
          if (!parsed.success) {
            const firstError = parsed.error.issues[0]?.message ?? "Некорректные данные";
            return Response.json({ error: firstError }, { status: 400 });
          }

          const { email, password } = parsed.data;
          const { supabase, applyCookies } = createSupabaseServerClient(request);

          const { data, error } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password,
          });

          if (error || !data.session || !data.user) {
            const message = error?.message ?? "Authentication failed";
            console.error("[auth/login]", message);
            return Response.json({ error: mapAuthError(message) }, { status: 401 });
          }

          const authUser = toAuthUser(data.user);
          if (!authUser) {
            return Response.json(
              {
                error:
                  "У пользователя не назначена роль. Укажите role: worker или manager в user_metadata.",
              },
              { status: 403 },
            );
          }

          const response = Response.json(
            {
              user: authUser,
              redirectTo: getRedirectForRole(authUser.role),
            },
            { status: 200 },
          );

          return applyCookies(response);
        } catch (error) {
          console.error("[auth/login]", error);
          return Response.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
        }
      },
    },
  },
});
