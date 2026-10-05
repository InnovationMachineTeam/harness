import type { SessionMetrics } from "@/core/types";
import { durationLabel, formatTokens } from "@/lib/format";

/**
 * Компактная строка метрик сессии из индекса: модель, токены, стоимость,
 * длительность, сообщения, инструменты. Пустые значения не показываются;
 * строки нет вовсе, если метрики ещё не собраны индексом.
 */
export function sessionMetricsParts(metrics: SessionMetrics): string[] {
  const total = metrics.inputTokens + metrics.outputTokens;
  const parts: string[] = [];
  if (metrics.models.length > 0) parts.push(metrics.models[0]!);
  if (total > 0) parts.push(`${formatTokens(total)} ток.`);
  if (metrics.cacheTokens > 0) parts.push(`кеш ${formatTokens(metrics.cacheTokens)}`);
  if (metrics.costUsd > 0) parts.push(`$${metrics.costUsd < 0.01 ? metrics.costUsd.toFixed(4) : metrics.costUsd.toFixed(2)}`);
  if (metrics.durationMs > 0) parts.push(durationLabel(metrics.durationMs));
  if (metrics.messageCount > 0) parts.push(`${metrics.messageCount} сообщ.`);
  if (metrics.toolCount > 0) parts.push(`инструменты: ${metrics.toolCount}`);
  return parts;
}

/** Компонент строки метрик для списков и карточек сессий. */
export function SessionMetricsLine({ metrics, className = "" }: { metrics: SessionMetrics; className?: string }) {
  const parts = sessionMetricsParts(metrics);
  if (parts.length === 0) return null;
  return <span className={className}>{parts.join(" · ")}</span>;
}
