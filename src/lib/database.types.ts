export type ErrorLogSeverity = "low" | "medium" | "high" | "critical";

export type ErrorLog = {
  id: string;
  worker_message: string;
  broken_part: string | null;
  severity: ErrorLogSeverity | null;
  action_plan: string | null;
  created_at: string;
};

export type DocumentMetadata = {
  source?: string;
  chunk_index?: number;
  [key: string]: unknown;
};

export type DocumentRow = {
  id: string;
  content: string;
  metadata: DocumentMetadata;
  embedding: string;
  created_at: string;
};

export type DocumentMatchRow = {
  id: string;
  content: string;
  metadata: DocumentMetadata;
  similarity: number;
};

export type Database = {
  public: {
    Tables: {
      documents: {
        Row: DocumentRow;
        Insert: {
          id?: string;
          content: string;
          metadata?: DocumentMetadata;
          embedding: number[] | string;
          created_at?: string;
        };
        Update: {
          id?: string;
          content?: string;
          metadata?: DocumentMetadata;
          embedding?: number[] | string;
          created_at?: string;
        };
        Relationships: [];
      };
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
    Functions: {
      match_documents: {
        Args: {
          query_embedding: number[] | string;
          match_threshold?: number;
          match_count?: number;
        };
        Returns: DocumentMatchRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
