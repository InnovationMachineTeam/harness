export type GuardEffect = "allow" | "warn" | "block" | "sanitize" | "require-approval";
export type GuardStatus = "planned" | "enforced" | "deprecated";

export interface GuardContext {
  runtime: string;
  tool: string;
  input: Record<string, unknown>;
  command: string;
  path: string;
}

export interface GuardCase {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  expect: "hit" | "pass";
  edge?: boolean;
}

export interface GuardRuleMeta {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  effect: Exclude<GuardEffect, "allow">;
  status: GuardStatus;
  threats: string[];
  bundles: string[];
  failureMode: "open" | "closed";
  remediation: string;
  limitations: string[];
  owner: string;
}

export interface GuardHit {
  effect: Exclude<GuardEffect, "allow">;
  ruleId: string;
  reason: string;
  remediation: string;
}

export interface GuardRule {
  meta: GuardRuleMeta;
  cases: GuardCase[];
  match(context: GuardContext): string | null;
}

export interface IntegrationRecord {
  id: string;
  title: string;
  purpose: string;
  protects: string;
  kind: "runtime-hook" | "code" | "git-hook" | "verification" | "ci";
  source: string;
  marker: string;
  bundles: string[];
  expectedFailureMode: "open" | "closed";
  notes: string;
}

export interface IntegrationAudit extends IntegrationRecord {
  status: "verified" | "degraded" | "missing";
  detail: string;
}

export interface GuardAuditSnapshot {
  schemaVersion: 1;
  policyVersion: string;
  policyDigest: string;
  generatedAt: string;
  totals: {
    rules: number;
    enforced: number;
    critical: number;
    integrations: number;
    verifiedIntegrations: number;
    degradedIntegrations: number;
    missingIntegrations: number;
    cases: number;
  };
  rules: Array<GuardRuleMeta & {
    cases: number;
    integrations: string[];
    implementation: string;
    examples: { blocked: string; allowed: string; edge: string };
  }>;
  integrations: IntegrationAudit[];
  checks: Array<{
    id: string;
    title: string;
    ok: boolean;
    detail: string;
    purpose: string;
    protects: string;
    evidence: string;
  }>;
}
