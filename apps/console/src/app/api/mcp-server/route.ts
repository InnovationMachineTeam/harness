import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { syncMcp } from "@/core/mcp/sync";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { loadHarnessMcpConfig, parseHarnessMcpConfig, saveHarnessMcpConfig } from "@/mcp-server/config";
import {
  applyHarnessMcpRegistration,
  HARNESS_MCP_HTTP_NAME,
  HARNESS_MCP_SERVER_NAME,
} from "@/mcp-server/registry";

export const dynamic = "force-dynamic";

/** Единая форма ответа GET и PUT: конфиг, HTTP-транспорт, регистрация, рабочие папки. */
async function harnessMcpServerState(ctx: Awaited<ReturnType<typeof serverContext>>) {
  return {
    config: await loadHarnessMcpConfig(ctx.repoRoot),
    http: ctx.state.mcpHttp ?? { enabled: false, token: "" },
    registration: {
      stdio: Boolean(ctx.state.mcp.servers[HARNESS_MCP_SERVER_NAME]),
      http: Boolean(ctx.state.mcp.servers[HARNESS_MCP_HTTP_NAME]),
    },
    workspaces: workspaceDirs(ctx.state),
  };
}

/** GET /api/mcp-server - конфигурация, состояние HTTP-транспорта и регистрации в реестре. */
export async function GET() {
  const ctx = await serverContext();
  return NextResponse.json(await harnessMcpServerState(ctx));
}

/**
 * PUT /api/mcp-server - сохранение конфигурации и действия регистрации:
 * {config?, stdio?: boolean, http?: {enabled: boolean, regenerateToken?: boolean}}.
 * После мутаций выполняется managed-синк реестра в конфиги рантаймов.
 */
export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | {
        config?: unknown;
        stdio?: boolean;
        http?: { enabled?: boolean; regenerateToken?: boolean };
      }
    | null;
  try {
    let syncNeeded = false;

    if (body?.config !== undefined) {
      await saveHarnessMcpConfig(ctx.repoRoot, parseHarnessMcpConfig(body.config));
    }

    if (typeof body?.stdio === "boolean") {
      applyHarnessMcpRegistration(ctx.state, ctx.repoRoot, { stdio: body.stdio });
      syncNeeded = true;
    }

    if (body?.http && typeof body.http.enabled === "boolean") {
      const current = ctx.state.mcpHttp ?? { enabled: false, token: "" };
      let token = current.token;
      if (body.http.regenerateToken || (body.http.enabled && !token)) token = randomBytes(24).toString("base64url");
      ctx.state.mcpHttp = { enabled: body.http.enabled, token: body.http.enabled ? token : current.token };
      applyHarnessMcpRegistration(ctx.state, ctx.repoRoot, {
        http: body.http.enabled ? { enabled: true, token: ctx.state.mcpHttp.token } : null,
      });
      syncNeeded = true;
    }

    let syncResults: unknown = null;
    if (syncNeeded) {
      syncResults = Object.values(await syncMcp(ctx.repoRoot, ctx.state));
      invalidateDashboardCache();
    }
    await ctx.saveState();

    return NextResponse.json({ ok: true, sync: syncResults, ...(await harnessMcpServerState(ctx)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
