import type { LlmGuard } from "./guard";

// Обвёртка модели: перехватывает invoke, stream и batch, редактирует
// тексты промпта и ответа, блокирует вызов при инъекции. Обвёртка не
// зависит от конкретной библиотеки: сохраняется прототип исходного
// объекта, поэтому LangChain-сообщения и чанки остаются рабочими.

const GUARDED_METHODS = new Set(["invoke", "stream", "batch", "predict", "call"]);

export class GuardBlockedError extends Error {
  readonly ruleId: string;

  constructor(ruleId: string, reason: string) {
    super(`guardrails: BLOCKED by ${ruleId} - ${reason}`);
    this.name = "GuardBlockedError";
    this.ruleId = ruleId;
  }
}

const MAX_DEPTH = 8;

/** Клон объекта с сохранением прототипа класса. */
function cloneLike(source: Record<string, unknown>): Record<string, unknown> {
  return Object.assign(Object.create(Object.getPrototypeOf(source)), source);
}

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";

const isThenable = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown }).then === "function";

function transformString(value: string, guard: LlmGuard, outbound: boolean): string {
  const result = outbound ? guard.guardPrompt(value) : guard.guardOutput(value);
  if (result.blocked) throw new GuardBlockedError(result.ruleId!, result.reason!);
  return result.text;
}

/**
 * Рекурсивно редактирует текстовые поля значения. Строки, массивы,
 * простые объекты и объекты с текстовым содержимым (content, text)
 * обрабатываются; генераторы, промисы и прочие классы без текстовых
 * полей возвращаются как есть, чтобы не ломать поток ответа.
 */
export function transformValue(value: unknown, guard: LlmGuard, outbound: boolean, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") return transformString(value, guard, outbound);
  if (Array.isArray(value)) return value.map((item) => transformValue(item, guard, outbound, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (isAsyncIterable(value) || isThenable(value)) return value;
  const source = value as Record<string, unknown>;
  const hasText = typeof source.content === "string" || typeof source.text === "string";
  if (Object.getPrototypeOf(source) !== Object.prototype && !hasText) return value;
  const clone = cloneLike(source);
  for (const key of Object.keys(clone)) {
    clone[key] = transformValue(clone[key], guard, outbound, depth + 1);
  }
  return clone;
}

/** Обвёртка модели: возвращает прокси с тем же интерфейсом. */
export function withLlmGuard<T extends object>(model: T, guard: LlmGuard): T {
  return new Proxy(model, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const bound = value.bind(target);
      // bindTools возвращает новую модель без guard - результат
      // оборачивается повторно, чтобы привязка инструментов не снимала защиту.
      if (property === "bindTools") {
        return (...toolArgs: unknown[]) => {
          const result = bound(...toolArgs);
          return result && typeof result === "object" ? (withLlmGuard(result as object, guard) as unknown) : result;
        };
      }
      if (!GUARDED_METHODS.has(property as string)) return bound;
      // Обёртка синхронна: вызов stream возвращает генератор сразу,
      // вызов invoke - Promise с преобразованным ответом.
      const finalize = (result: unknown): unknown => {
        if (result && isAsyncIterable(result)) {
          return (async function* () {
            for await (const chunk of result) yield transformValue(chunk, guard, false);
          })();
        }
        if (result && isThenable(result)) return result.then(finalize);
        return transformValue(result, guard, false);
      };
      return (...callArgs: unknown[]) => {
        try {
          if (callArgs.length > 0) callArgs[0] = transformValue(callArgs[0], guard, true);
        } catch (error) {
          // stream возвращает генератор, который бросает ошибку при первом
          // чтении; остальные методы - отвергнутый Promise.
          if (property === "stream") return (async function* () { throw error; })();
          return Promise.reject(error);
        }
        return finalize(bound(...callArgs));
      };
    },
    set(target, property, newValue) {
      Reflect.set(target, property, newValue);
      return true;
    },
  });
}

/**
 * Узел-фильтр для LangGraph: возвращает функцию узла, которая
 * редактирует сообщения состояния перед модельным узлом.
 */
export function langGraphGuardNode(guard: LlmGuard): (state: { messages?: unknown[] }) => { messages: unknown[] } {
  return (state) => {
    const messages = Array.isArray(state.messages) ? state.messages : [];
    return { messages: transformValue(messages, guard, true) as unknown[] };
  };
}
