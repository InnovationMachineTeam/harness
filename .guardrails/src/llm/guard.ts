import { scanText } from "../content/scan";
import { redactText } from "../content/redact";
import { defaultRegistry, type SessionRegistry } from "./session";

// Точки применения guard к текстам, идущим в модель и возвращающимся
// из неё. Промпт: блокировка инъекций и редактирование данных перед
// отправкой. Ответ: редактирование перед показом или передачей дальше.

export interface GuardTextResult {
  text: string;
  blocked: boolean;
  ruleId?: string;
  reason?: string;
  /** Выполненные замены и предупредительные находки (только метки). */
  applied: string[];
  warnings: string[];
}

export interface LlmGuard {
  guardPrompt(text: string): GuardTextResult;
  guardOutput(text: string): GuardTextResult;
  learn(field: string, value: string): void;
  readonly registry: SessionRegistry | null;
}

export interface LlmGuardOptions {
  /** Реестр значений сессии; по умолчанию общий реестр процесса. */
  registry?: SessionRegistry | null;
  /** Блокировать промпт при инъекции; по умолчанию true. */
  blockOnInjection?: boolean;
  /** Редактировать ответ; по умолчанию true. */
  redactOutput?: boolean;
}

function warningsFor(text: string): string[] {
  return scanText(text, "prompt")
    .filter((finding) => finding.patternId.startsWith("marker."))
    .map((finding) => `marker:${finding.patternId.slice("marker.".length)}`);
}

export function createLlmGuard(options: LlmGuardOptions = {}): LlmGuard {
  const registry = options.registry === undefined ? defaultRegistry : options.registry;
  const blockOnInjection = options.blockOnInjection ?? true;
  const redactOutput = options.redactOutput ?? true;

  const guardPrompt = (text: string): GuardTextResult => {
    const injection = scanText(text, "prompt").find((finding) => finding.patternId.startsWith("inj."));
    if (injection && blockOnInjection) {
      return { text, blocked: true, ruleId: "prompt.injection", reason: `Промпт содержит "${injection.title}".`, applied: [], warnings: [] };
    }
    const redacted = redactText(text, "llm-io", { registry });
    return { text: redacted.text, blocked: false, applied: redacted.applied, warnings: warningsFor(text) };
  };

  const guardOutput = (text: string): GuardTextResult => {
    if (!redactOutput) return { text, blocked: false, applied: [], warnings: [] };
    const redacted = redactText(text, "llm-io", { registry });
    return { text: redacted.text, blocked: false, applied: redacted.applied, warnings: [] };
  };

  return {
    guardPrompt,
    guardOutput,
    learn: (field, value) => registry?.learn(field, value),
    registry,
  };
}
