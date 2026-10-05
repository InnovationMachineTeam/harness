export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { command?: string; file_path?: string; path?: string } & Record<string, unknown>;
  prompt?: string;
  source?: string;
  cwd?: string;
}

export interface HookOutcome {
  output: string;
  fired: boolean;
  childExit: number;
}

export const SILENT: HookOutcome = { output: "", fired: false, childExit: 0 };

export function parseHookInput(raw: string): HookInput {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as HookInput) : {};
  } catch {
    return {};
  }
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function repoRoot(): string {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.ZCODE_PROJECT_DIR ||
    process.env.CURSOR_PROJECT_DIR ||
    process.cwd()
  );
}

export function emit(text: string): void {
  if (!text) return;
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}
