import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatErrorId,
  severityLabels,
  useErrorLogs,
} from "@/hooks/use-error-logs";

export const Route = createFileRoute("/manager")({
  head: () => ({
    meta: [{ title: "Error Logs — Factory Console" }],
  }),
  component: ManagerPage,
});

function ManagerPage() {
  const navigate = useNavigate();
  const { data: logs = [], isLoading, isError, configured } = useErrorLogs();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="text-sm font-medium text-foreground">Manager Console</div>
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {!configured ? (
          <p className="mb-4 text-sm text-muted-foreground">
            Supabase не настроен. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в
            файл .env и выполните SQL из supabase/schema.sql.
          </p>
        ) : null}

        {isError ? (
          <p className="mb-4 text-sm text-destructive">
            Не удалось загрузить журнал ошибок. Проверьте таблицу error_logs в Supabase.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID ошибки</TableHead>
                <TableHead>Сломанная деталь</TableHead>
                <TableHead>Критичность</TableHead>
                <TableHead>Сообщение от работника</TableHead>
                <TableHead>План действий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Загрузка…
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Пока нет сообщений от работников.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">
                      {formatErrorId(log.id)}
                    </TableCell>
                    <TableCell>{log.broken_part ?? "—"}</TableCell>
                    <TableCell>
                      {log.severity ? severityLabels[log.severity] : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      {log.worker_message}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      {log.action_plan ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}