export type ErrorLogSeverity = "low" | "medium" | "high" | "critical";

export type ErrorLog = {
  id: string;
  worker_message: string;
  broken_part: string | null;
  severity: ErrorLogSeverity | null;
  action_plan: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      error_logs: {
        Row: ErrorLog;
        Insert: {
          id?: string;
          worker_message: string;
          broken_part?: string | null;
          severity?: ErrorLogSeverity | null;
          action_plan?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          worker_message?: string;
          broken_part?: string | null;
          severity?: ErrorLogSeverity | null;
          action_plan?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
