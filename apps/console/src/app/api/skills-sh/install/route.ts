import { NextResponse } from "next/server";
import { getJob, startInstallJob } from "@/core/installJobs";
import { invalidateDashboardCache } from "@/core/cache";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** POST /api/skills-sh/install {pkg} - запустить `bunx skills add <pkg> -y`. */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { pkg?: string } | null;
  const pkg = body?.pkg?.trim() ?? "";
  const job = startInstallJob(ctx.repoRoot, pkg);
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, jobId: job.id, pkg: job.pkg });
}

/** GET /api/skills-sh/install?jobId= - SSE-стрим вывода установки. */
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "job не найден" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (line: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
      };
      for (const line of job.lines) send(line);
      if (job.done) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: job.exitCode })}\n\n`),
        );
        controller.close();
        return;
      }
      job.listeners.add(send);
      const finish = () => {
        job.listeners.delete(send);
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: job.exitCode })}\n\n`),
          );
          controller.close();
        } catch {
          /* контроллер уже закрыт */
        }
      };
      // когда придёт пустая строка-маркер завершения - закрываем стрим
      const wrapper = (line: string) => {
        if (line === "" || job.done) finish();
      };
      job.listeners.add(wrapper);
      request.signal.addEventListener("abort", () => {
        job.listeners.delete(send);
        job.listeners.delete(wrapper);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
