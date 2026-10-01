"use client";

import { Chip, type ChipTone } from "@/ui/UIKit";

export interface ShAudit {
  provider: string;
  status: string;
  summary?: string;
  riskLevel?: string;
}

const AUDIT_TONES: Record<string, ChipTone> = {
  pass: "emerald",
  Safe: "emerald",
  warn: "amber",
  fail: "red",
};

function auditTone(audit: ShAudit): ChipTone {
  const key = audit.status in AUDIT_TONES ? audit.status : (audit.riskLevel ?? "");
  return AUDIT_TONES[key] ?? (audit.status.toLowerCase().includes("med") ? "amber" : "neutral");
}

/** Чипы аудита безопасности навыка (pass/warn/fail по провайдерам). */
export function AuditChips({ audits }: { audits: ShAudit[] }) {
  if (audits.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {audits.map((audit) => (
        <Chip key={audit.provider} size="sm" tone={auditTone(audit)} title={audit.summary ?? ""}>
          {audit.provider}: {audit.status}
          {audit.riskLevel ? ` (${audit.riskLevel})` : ""}
        </Chip>
      ))}
    </div>
  );
}
