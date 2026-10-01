import { NextResponse } from "next/server";
import { loadVendorConfigs } from "@/core/registry";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtimes/list - лёгкий перечень рантимов без проба активности:
 * источник правды .agents/runtime/&lt;vendor&gt;/config.json + адаптеры консоли.
 * Питает клиентский store и плагин-реестр рантаймов.
 */
export async function GET() {
  const ctx = await serverContext();
  const vendors = await loadVendorConfigs(ctx.repoRoot);
  const runtimes = vendors.map((vendor) => ({
    id: vendor.id ?? "?",
    displayName: ctx.adapters[vendor.id ?? ""]?.displayName ?? (vendor.id ?? "?"),
    hasAdapter: Boolean(ctx.adapters[vendor.id ?? ""]),
    hooksSupport: vendor.guard?.hooksSupport ?? "?",
  }));
  return NextResponse.json({ runtimes });
}
