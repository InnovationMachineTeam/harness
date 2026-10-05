import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HookDeps } from "../indexes/deps";
import type { ChildResult } from "../lib/child";

export async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "harness-hooks-"));
}

export async function put(path: string, content = "x\n"): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export function putIn(root: string, rel: string, content = "x\n"): Promise<void> {
  return put(join(root, rel), content);
}

export interface StubDeps extends HookDeps {
  calls: { cmd: string; args: string[] }[];
}

export function stubDeps(child: Partial<ChildResult> = {}): StubDeps {
  const calls: StubDeps["calls"] = [];
  return {
    calls,
    runChild: (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: "CHILD-OUT\n", exitCode: 0, timedOut: false, missing: false, ...child };
    },
    commandExists: () => true,
  };
}
