import { expect, test } from "bun:test";
import { buildAudit } from "../src/audit";

test("аудит подтверждает каталог и wiring", () => {
  const audit = buildAudit(process.cwd());
  expect(audit.checks.every((check) => check.ok)).toBeTrue();
  expect(audit.totals.missingIntegrations).toBe(0);
  expect(audit.policyDigest).toMatch(/^[a-f0-9]{64}$/);
});
