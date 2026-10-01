import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import { toolJobFiles } from "@/core/toolJobs";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools/job?jobId= - SSE-стрим вывода job'а инструмента.
 * Вывод и статус читаются из единого файлового лога
 * (.agents/console/tool-jobs/jobs.log + jobs-meta.jsonl, строки/записи
 * помечены `<id>\t`): в dev у каждого route-бандла своя копия toolJobs-модуля,
 * и in-memory Map пуста - файловый источник инвариантен к HMR и границам
 * бандлов. jobId используется только как префикс-фильтр строк, не в путях.
 */
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!/^[A-Za-z0-9-]{1,64}$/.test(jobId)) {
    return NextResponse.json({ error: "job не найден" }, { status: 404 });
  }
  const files = toolJobFiles(findRepoRoot());
  const prefix = `${jobId}\t`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* контроллер закрыт */
        }
      };

      let sent = 0; // сколько строк job'а уже отправлено
      let finished = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      const finish = (exitCode: number | null) => {
        if (finished) return;
        finished = true;
        if (timer) clearInterval(timer);
        timer = null;
        send({ done: true, exitCode });
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      };

      const tick = async () => {
        if (finished) return;
        try {
          const log = await readFile(files.log, "utf8").catch(() => "");
          const lines = log
            .split("\n")
            .filter((l) => l.startsWith(prefix))
            .map((l) => l.slice(prefix.length));
          while (sent < lines.length) {
            send({ line: lines[sent] });
            sent += 1;
          }
          // статус - последняя запись меты с этим id (файл-журнал дописывается)
          const meta = await readFile(files.meta, "utf8").catch(() => "");
          let done: boolean | null = null;
          let exitCode: number | null = null;
          for (const row of meta.split("\n")) {
            if (!row.trim()) continue;
            try {
              const entry = JSON.parse(row) as { id?: string; done?: boolean; exitCode?: number | null };
              if (entry.id === jobId && typeof entry.done === "boolean") {
                done = entry.done;
                exitCode = entry.done ? (entry.exitCode ?? null) : null;
              }
            } catch {
              /* повреждённая строка журнала - пропускаем */
            }
          }
          if (done) finish(exitCode);
        } catch {
          /* файлы ещё не созданы - ждём следующего тика */
        }
      };

      await tick();
      if (finished) return;
      timer = setInterval(() => void tick(), 400);
      request.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        finished = true;
      });
      // страховка: не держим соединение дольше 15 минут
      setTimeout(() => finish(null), 15 * 60_000).unref?.();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
