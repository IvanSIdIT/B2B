import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { ErrorLog } from "@/lib/database.types";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

async function fetchErrorLogs(): Promise<ErrorLog[]> {
  const { data, error } = await getSupabase()
    .from("error_logs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export function useErrorLogs() {
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const query = useQuery({
    queryKey: ["error_logs"],
    queryFn: fetchErrorLogs,
    enabled: configured,
  });

  useEffect(() => {
    if (!configured) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel("error_logs_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "error_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["error_logs"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [configured, queryClient]);

  return { ...query, configured };
}

export const severityLabels: Record<NonNullable<ErrorLog["severity"]>, string> = {
  low: "Низкая",
  medium: "Средняя",
  high: "Высокая",
  critical: "Критическая",
};

export function formatErrorId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
