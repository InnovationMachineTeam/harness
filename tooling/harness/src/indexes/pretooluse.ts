import { SILENT, type HookInput, type HookOutcome } from "../lib/hook-io";
import { realDeps, type HookDeps } from "./deps";
import { graphifyGuardRead, graphifyGuardSearch } from "./graphify";
import { serenaRemind } from "./serena";

// Агрегатор PreToolUse для рантаймов без матчеров (Cursor): один вызов
// обёртки обслуживает все инструменты, фильтрация по tool_name здесь.
export function preToolUseAll(
  root: string,
  raw: string,
  input: HookInput,
  deps: HookDeps = realDeps,
): HookOutcome {
  const tool = input.tool_name ?? "";
  const outputs: string[] = [];
  let childExit = 0;

  const collect = (outcome: HookOutcome): void => {
    if (outcome.output) outputs.push(outcome.output);
    if (outcome.childExit) childExit = outcome.childExit;
  };

  if (tool === "Bash" || tool === "Grep") collect(graphifyGuardSearch(root, raw, input, deps));
  if (tool === "Read" || tool === "Glob") collect(graphifyGuardRead(root, raw, input, deps));
  if (tool === "Read" || tool === "Grep") collect(serenaRemind(root, raw, input, deps));

  if (!outputs.length) return SILENT;
  return { output: outputs.join("\n"), fired: true, childExit };
}
