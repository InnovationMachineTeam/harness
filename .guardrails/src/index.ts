// Публичный API Guardrails для потребителей внутри репозитория
// (консоль, обёртки вызовов моделей). CLI-движок остаётся в src/cli.ts.
export { CONTENT_PATTERNS, luhn, inn } from "./content/patterns";
export { scanText, scanDeep, decodeVariants, highestSeverity } from "./content/scan";
export type { ScanFinding } from "./content/scan";
export type { Surface } from "./content/patterns";
export { redactText } from "./content/redact";
export type { RedactResult } from "./content/redact";
export { MAX_PII_PROBES, ProbeStore, probeMatches } from "./content/probes";
export { CONTENT_RULES } from "./content/catalog";
export { createLlmGuard } from "./llm/guard";
export type { LlmGuard, LlmGuardOptions, GuardTextResult } from "./llm/guard";
export { SessionRegistry, encodedVariants, defaultRegistry } from "./llm/session";
export { GuardBlockedError, withLlmGuard, langGraphGuardNode, transformValue } from "./llm/wrappers";
export { coerceStructuredOutput, isHarmful } from "./llm/schema";
export type { OutputSchema, CoerceResult } from "./llm/schema";
export { classifierFromEnv, classifierFromOllama } from "./llm/classifier";
export type { ContentClassifier, ClassifierVerdict } from "./llm/classifier";
export { classifierGate } from "./llm/classifierGate";
export { loadExceptions, exceptionMatches, findException } from "./exceptions/loader";
export type { GuardException, ExceptionLoadResult } from "./exceptions/loader";
export { readDecisions, appendDecision, eventsPath, MAX_LOG_BYTES } from "./audit-log";
