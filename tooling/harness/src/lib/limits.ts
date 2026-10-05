export const OUTPUT_CAP_BYTES = 4096;
export const CAP_SUFFIX = "\ncall codegraph_explore for the rest";

// Обрезка вывода ребёнка до бюджета N-2. Для envelope hookSpecificOutput
// обрезается additionalContext, иначе JSON стал бы невалидным. Резерв 1 байт -
// на перевод строки, который emit добавляет к выводу без него.
export function capOutput(out: string, maxBytes: number = OUTPUT_CAP_BYTES): string {
  const limit = maxBytes - 1;
  if (Buffer.byteLength(out, "utf8") <= limit) return out;
  try {
    const parsed: unknown = JSON.parse(out);
    const envelope = parsed as { hookSpecificOutput?: { additionalContext?: string } };
    const ctx = envelope?.hookSpecificOutput?.additionalContext;
    if (typeof ctx === "string") {
      let keep = Math.max(0, limit - Buffer.byteLength(CAP_SUFFIX, "utf8") - 64);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        envelope.hookSpecificOutput.additionalContext = ctx.slice(0, keep) + CAP_SUFFIX;
        const json = JSON.stringify(envelope);
        const size = Buffer.byteLength(json, "utf8");
        if (size <= limit) return json;
        keep = Math.max(0, keep - (size - limit));
      }
    }
  } catch {
    // не JSON - обрезаем как текст
  }
  const suffixBytes = Buffer.byteLength(CAP_SUFFIX, "utf8");
  return Buffer.from(out, "utf8").subarray(0, Math.max(0, limit - suffixBytes)).toString("utf8") + CAP_SUFFIX;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
