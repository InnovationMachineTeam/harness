import { expect, test } from "bun:test";
import { checkCleanPrompts, loadCleanCorpus } from "../src/fprcheck";
import { createLlmGuard } from "../src/llm/guard";
import { SessionRegistry } from "../src/llm/session";

test("чистый корпус проходит без блока, предупреждений и редактирования", () => {
  const corpus = loadCleanCorpus();
  expect(corpus.prompts.length).toBeGreaterThanOrEqual(20);
  const verdicts = checkCleanPrompts(corpus.prompts, createLlmGuard({ registry: new SessionRegistry() }));
  const failed = verdicts.filter((verdict) => verdict.blocked || verdict.applied.length || verdict.warnings.length);
  expect(failed.map((verdict) => `#${verdict.index + 1} ${verdict.ruleId ?? verdict.applied.join(",") ?? verdict.warnings.join(",")}`)).toEqual([]);
});
