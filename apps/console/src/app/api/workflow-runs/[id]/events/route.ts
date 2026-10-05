import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { WorkflowStore } from "@/core/workflows/storage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  const url = new URL(request.url);
  const workspace = resolveWorkflowWorkspace(ctx.state, url.searchParams.get("workspace"));
  let cursor = Number(url.searchParams.get("cursor") ?? request.headers.get("last-event-id") ?? "0") || 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const store = new WorkflowStore(ctx.repoRoot, workspace);
      const send = (event: string, data: unknown, eventId?: number) => {
        const idLine = eventId ? "id: " + eventId + "\n" : "";
        controller.enqueue(encoder.encode(idLine + "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"));
      };
      try {
        while (!request.signal.aborted) {
          const events = store.listEvents(id, cursor, 200);
          for (const event of events) {
            cursor = event.id;
            send("workflow", event, event.id);
          }
          const run = store.getRun(id);
          if (!run) {
            send("error", { error: "run не найден" });
            break;
          }
          if (["completed", "failed", "cancelled"].includes(run.status) && events.length === 0) {
            send("done", { status: run.status, cursor });
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } finally {
        store.close();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
