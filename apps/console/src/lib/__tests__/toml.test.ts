import { describe, expect, test } from "bun:test";
import { removeMcpSection, upsertMcpSection } from "@/lib/toml";

const BASE = `[model]
reasoning = "high"

[mcp_servers.existing]
command = "keep-me"
args = ["--stay"]

[other]
key = "value"
`;

describe("TOML mcp-редактор", () => {
  test("upsert добавляет секцию, не изменяя остальное", () => {
    const out = upsertMcpSection(BASE, "serena", { command: "uvx", args: ["serena"] });
    expect(out).toContain("[mcp_servers.serena]");
    expect(out).toContain('command = "uvx"');
    expect(out).toContain('args = ["serena"]');
    expect(out).toContain("[mcp_servers.existing]");
    expect(out).toContain("[other]");
    expect(out).toContain('key = "value"');
  });

  test("upsert заменяет существующую секцию и её env-подтаблицу", () => {
    const once = upsertMcpSection(BASE, "old", { command: "a", env: { K: "v" } });
    expect(once).toContain("[mcp_servers.old.env]");
    const twice = upsertMcpSection(once, "old", { command: "b" });
    expect(twice).toContain('command = "b"');
    expect(twice).not.toContain("[mcp_servers.old.env]");
    expect(twice.match(/\[mcp_servers\.old\]/g)?.length).toBe(1);
  });

  test("remove удаляет секцию и подсекцию .env, остальное сохраняет", () => {
    const withSection = upsertMcpSection(BASE, "temp", { command: "x", env: { A: "1" } });
    const cleaned = removeMcpSection(withSection, "temp");
    expect(cleaned).not.toContain("[mcp_servers.temp]");
    expect(cleaned).not.toContain("[mcp_servers.temp.env]");
    expect(cleaned).toContain("[mcp_servers.existing]");
    expect(cleaned).toContain("[other]");
  });

  test("http-сервер сериализуется через url", () => {
    const out = upsertMcpSection("", "remote", { url: "https://example.com/mcp" });
    expect(out).toContain('[mcp_servers.remote]');
    expect(out).toContain('url = "https://example.com/mcp"');
  });

  test("remove несуществующей секции - no-op", () => {
    expect(removeMcpSection(BASE, "nope")).toBe(BASE);
  });
});
