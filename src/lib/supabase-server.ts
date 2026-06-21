import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  type CookieOptions,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from "./env";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export type SupabaseServerClient = {
  supabase: SupabaseClient<Database>;
  applyCookies: (response: Response) => Response;
};

export function createSupabaseServerClient(
  request: Request,
): SupabaseServerClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured.");
  }

  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          const header = request.headers.get("Cookie") ?? "";
          return parseCookieHeader(header).map(({ name, value }) => ({
            name,
            value: value ?? "",
          }));
        },
        setAll(cookies) {
          cookiesToSet.push(...cookies);
        },
      },
    },
  );

  return {
    supabase,
    applyCookies(response) {
      if (cookiesToSet.length === 0) return response;

      const headers = new Headers(response.headers);
      for (const { name, value, options } of cookiesToSet) {
        headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}
