/**
 * Managed-блоки в markdown-файлах: консоль владеет только содержимым между
 * маркерами start/end, остальной текст файла не меняется. Один и тот же блок
 * в файле не дублируется - повторная запись заменяет прежнее содержимое.
 * Используется интеграциями инструментов (rtk-instructions) и дизайн-слоем
 * (harness-design в CLAUDE.md/AGENTS.md рабочих папок).
 */

export interface ManagedMarkers {
  start: string;
  end: string;
}

/** Маркеры блока по имени: `<!-- <name>:start -->` / `<!-- <name>:end -->`. */
export function managedMarkers(name: string): ManagedMarkers {
  return { start: `<!-- ${name}:start -->`, end: `<!-- ${name}:end -->` };
}

function blockRegex(name: string): RegExp {
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const { start, end } = managedMarkers(name);
  return new RegExp(`${escape(start)}[\\s\\S]*?${escape(end)}\\n?`, "g");
}

/** Есть ли в тексте managed-блок с этим именем. */
export function hasManagedBlock(text: string, name: string): boolean {
  return blockRegex(name).test(text);
}

/**
 * Записать блок: существующий заменяется, при отсутствии блок дописывается
 * в конец файла. Содержимое тримится; `$` в тексте блока не трактуется как
 * ссылка на группу замены.
 */
export function upsertManagedBlock(text: string, name: string, content: string): string {
  const { start, end } = managedMarkers(name);
  const full = `${start}\n${content.trimEnd()}\n${end}\n`;
  const regex = blockRegex(name);
  if (regex.test(text)) {
    return text.replace(regex, () => full);
  }
  const gap = text.length === 0 ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${gap}${full}`;
}

/** Удалить блок; возвращает текст без него (без блока текст не меняется). */
export function removeManagedBlock(text: string, name: string): string {
  const regex = blockRegex(name);
  if (!regex.test(text)) return text;
  const cleaned = text.replace(regex, "");
  // блок в конце файла оставляет пустые строки - схлопываем в один перенос
  return cleaned.replace(/\n{2,}$/, "\n");
}
