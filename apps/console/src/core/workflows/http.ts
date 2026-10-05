import path from "node:path";
import type { ConsoleState } from "../state";
import { workspaceDirs } from "../state";

export function resolveWorkflowWorkspace(state: ConsoleState, requested: string | null | undefined): string {
  const dirs = workspaceDirs(state);
  const candidate = requested?.trim() || state.workspaces.mandatory;
  const resolved = path.resolve(candidate);
  const found = dirs.find((dir) => path.resolve(dir) === resolved);
  if (!found) throw new Error("папка не входит в список рабочих папок");
  return found;
}
