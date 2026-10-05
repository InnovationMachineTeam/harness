import { NextResponse } from "next/server";
import path from "node:path";
import { resolveDesignRouter } from "@/core/design/run";
import { designSyncStatus, removeDesignContext, syncDesignContext } from "@/core/design/sync";
import {
  brandTemplate,
  createDesignPack,
  loadDesignPack,
  registerWorkspaceKit,
  saveComponentsManifest,
  saveWorkspaceBrand,
  saveWorkspaceDesign,
  saveWorkspaceDesignGuide,
  saveWorkspaceUikit,
  scanWorkspaceComponents,
  uikitTemplate,
  type ComponentsManifest,
} from "@/core/design/workspace";
import { detectToolCli } from "@/core/tools";
import type { ConsoleState } from "@/core/state";
import { workspaceDirs } from "@/core/state";
import { validateThemeName, validateTokens } from "@/lib/design-format";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * Дизайн-контекст рабочей папки. GET ?dir= - статус пакета (DESIGN.md,
 * BRAND.md, ui-kit, components), синхронизации, готовность провайдеров
 * дизайна (designTools). POST {action, dir, ...} - действия: init (пакет
 * из пресета themes/), save-design, save-brand, save-uikit, scan-components,
 * save-components, sync (managed-блоки CLAUDE.md/AGENTS.md), desync.
 * dir - только папки из рабочих папок консоли.
 */

/** Готовность провайдеров дизайна для панели "Провайдеры дизайна". */
function designToolsStatus(state: ConsoleState): Record<string, { ready: boolean; detail: string }> {
  const od = detectToolCli("od");
  const openMcp = Boolean(state.mcp.servers["open-design"]?.enabled);
  const figmaMcp = Boolean(state.mcp.servers.figma?.enabled);
  return {
    "claude-design": {
      ready: true,
      detail: "встроенная команда /design (Claude Code ≥ 2.1.234, research preview); артборды - в сессии рантайма",
    },
    "open-design": {
      ready: openMcp && od.installed,
      detail: `${openMcp ? "MCP включён" : "MCP выключен (Настройки → MCP)"}; ${od.installed ? "CLI od найден" : "CLI od не найден (Open Design не установлен)"}`,
    },
    figma: {
      ready: figmaMcp,
      detail: figmaMcp ? "MCP включён; OAuth при первом вызове" : "MCP выключен (Настройки → MCP)",
    },
  };
}

function resolveWorkspaceDir(raw: string | null | undefined, workspaces: string[]): string | null {
  if (!raw) return null;
  const resolved = path.resolve(raw);
  return workspaces.includes(resolved) ? resolved : null;
}

function invalidDir(dir: string | null): NextResponse | null {
  if (dir) return null;
  return NextResponse.json({ error: "папка не входит в рабочие папки консоли (параметр dir)" }, { status: 400 });
}

export async function GET(request: Request) {
  const ctx = await serverContext();
  const url = new URL(request.url);
  const dir = resolveWorkspaceDir(url.searchParams.get("dir"), workspaceDirs(ctx.state));
  const bad = invalidDir(dir);
  if (bad || !dir) return bad!;
  const [pack, sync] = await Promise.all([
    loadDesignPack(dir),
    designSyncStatus(dir, ctx.state.mcp.servers),
  ]);
  const providers = Object.entries(ctx.state.providers.entries)
    .filter(([, entry]) => entry.verifiedAt !== null && !entry.verifyError)
    .map(([id]) => id);
  return NextResponse.json({
    dir,
    pack,
    sync,
    providers,
    router: resolveDesignRouter(ctx.state),
    designProviders: ctx.state.settings.workflows.designProviders,
    designTools: designToolsStatus(ctx.state),
  });
}

interface WorkspacePostBody {
  action?: unknown;
  dir?: unknown;
  presetFile?: unknown;
  overwrite?: unknown;
  tokens?: unknown;
  name?: unknown;
  content?: unknown;
  manifest?: unknown;
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as WorkspacePostBody | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "нужен JSON: { action, dir, ... }" }, { status: 400 });
  }
  const dir = resolveWorkspaceDir(typeof body.dir === "string" ? body.dir : null, workspaceDirs(ctx.state));
  const bad = invalidDir(dir);
  if (bad || !dir) return bad!;
  const servers = ctx.state.mcp.servers;

  switch (body.action) {
    case "init": {
      if (typeof body.presetFile !== "string" || !body.presetFile.trim()) {
        return NextResponse.json({ error: "init: нужен presetFile из themes/" }, { status: 400 });
      }
      const result = await createDesignPack(ctx.repoRoot, dir, body.presetFile.trim(), { overwrite: body.overwrite === true });
      return result.ok ? NextResponse.json({ ok: true, files: result.files }) : NextResponse.json({ error: result.error }, { status: 400 });
    }
    case "save-design": {
      const tokens = validateTokens(body.tokens);
      if ("error" in tokens) return NextResponse.json({ error: `save-design: ${tokens.error}` }, { status: 400 });
      const result = await saveWorkspaceDesign(dir, tokens, validateThemeName(body.name));
      return NextResponse.json(
        result.ok
          ? { ok: true, name: result.name, warnings: result.warnings, findings: result.findings }
          : { error: result.error, findings: result.findings },
        { status: result.ok ? 200 : 400 },
      );
    }
    case "save-design-guide": {
      if (typeof body.content !== "string") return NextResponse.json({ error: "save-design-guide: нужен content (тело после front matter)" }, { status: 400 });
      const result = await saveWorkspaceDesignGuide(dir, body.content);
      return NextResponse.json(
        result.ok ? { ok: true, warnings: result.warnings, findings: result.findings } : { error: result.error, findings: result.findings },
        { status: result.ok ? 200 : 400 },
      );
    }
    case "save-brand": {
      if (typeof body.content !== "string") return NextResponse.json({ error: "save-brand: нужен content" }, { status: 400 });
      try {
        await saveWorkspaceBrand(dir, body.content);
      } catch (error) {
        return NextResponse.json({ error: `save-brand: ${String(error)}` }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }
    case "brand-template": {
      return NextResponse.json({ ok: true, content: brandTemplate() });
    }
    case "uikit-template": {
      return NextResponse.json({ ok: true, content: uikitTemplate() });
    }
    case "save-uikit": {
      if (typeof body.content !== "string") return NextResponse.json({ error: "save-uikit: нужен content" }, { status: 400 });
      try {
        await saveWorkspaceUikit(dir, body.content);
      } catch (error) {
        return NextResponse.json({ error: `save-uikit: ${String(error)}` }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }
    case "scan-components": {
      const manifest = await scanWorkspaceComponents(dir);
      await saveComponentsManifest(dir, manifest);
      return NextResponse.json({ ok: true, manifest });
    }
    case "register-kit": {
      const result = await registerWorkspaceKit(dir);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    case "save-components": {
      const raw = body.manifest as Partial<ComponentsManifest> | undefined;
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.web) || !Array.isArray(raw.mobile)) {
        return NextResponse.json({ error: "save-components: нужен manifest { web: [], mobile: [] }" }, { status: 400 });
      }
      const manifest: ComponentsManifest = { version: 1, updated: new Date().toISOString(), web: raw.web, mobile: raw.mobile };
      await saveComponentsManifest(dir, manifest);
      return NextResponse.json({ ok: true });
    }
    case "sync": {
      const pack = await loadDesignPack(dir);
      if (!pack.design.exists) {
        return NextResponse.json({ error: "sync: в папке нет DESIGN.md - сначала создайте пакет" }, { status: 400 });
      }
      const result = await syncDesignContext(dir, pack, servers);
      return NextResponse.json({ ok: true, ...result });
    }
    case "desync": {
      const result = await removeDesignContext(dir, servers);
      return NextResponse.json({ ok: true, ...result });
    }
    default:
      return NextResponse.json({ error: `неизвестное действие: ${body.action}` }, { status: 400 });
  }
}
