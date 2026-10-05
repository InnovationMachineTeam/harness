import { NextResponse } from "next/server";
import { z } from "zod";
import { listDirectChats, readDirectChat, saveDirectChat } from "@/core/directChats";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const messageSchema = z.object({
  role: z.string(),
  parts: z.array(z.object({ type: z.string() }).loose()).default([]),
  id: z.string().optional(),
  metadata: z.unknown().optional(),
});

const saveSchema = z.object({
  id: z.string().optional(),
  messages: z.array(messageSchema).min(1).max(500),
  times: z.record(z.string(), z.object({ startedAt: z.string().optional(), repliedAt: z.string().optional() })).optional(),
});

/**
 * GET /api/direct-chats[?id=] - список Direct-чатов или один чат с сообщениями.
 * POST /api/direct-chats {id?, messages, times?} - создать или перезаписать чат.
 * Хранение - .agents/console/direct/<id>/ (chat.json + input/, output/).
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ chats: await listDirectChats(ctx.repoRoot) });
  }
  const chat = await readDirectChat(ctx.repoRoot, id);
  if (!chat) return NextResponse.json({ error: "чат не найден" }, { status: 404 });
  return NextResponse.json({ chat });
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = saveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "неверное тело запроса: " + body.error.issues[0]?.message }, { status: 400 });
  }
  try {
    const chat = await saveDirectChat(ctx.repoRoot, body.data);
    return NextResponse.json({ chat }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
