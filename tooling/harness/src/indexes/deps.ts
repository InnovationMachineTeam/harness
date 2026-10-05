import { commandExists, runChild } from "../lib/child";

export interface HookDeps {
  runChild: typeof runChild;
  commandExists: typeof commandExists;
}

export const realDeps: HookDeps = { runChild, commandExists };
