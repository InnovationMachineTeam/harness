import type { NavNode } from "@/core/memory";
import type { NavGroup } from "./MemoryNav";

/** DTO /api/memory/runtimes (зеркало core/memory, даты - строки). */
export interface MemoryFileDTO {
  path: string;
  relPath: string;
  name: string;
  mtime: string;
}

export interface MemorySourceDTO {
  label: string;
  workspaceDir: string | null;
  root: string;
  files: MemoryFileDTO[];
}

export interface RuntimeMemoryDTO {
  id: string;
  displayName: string;
  supported: boolean;
  note?: string;
  sources: MemorySourceDTO[];
}

/** Подпись подгруппы памяти: имя рабочей папки или "Глобальные". */
export function sourceDirLabel(workspaceDir: string | null): string {
  if (!workspaceDir) return "Глобальные";
  return workspaceDir.split("/").filter(Boolean).pop() ?? workspaceDir;
}

/** Файлы источника как узлы дерева. */
export function sourceNodes(source: MemorySourceDTO): NavNode {
  return {
    name: sourceDirLabel(source.workspaceDir),
    path: source.root,
    kind: "dir",
    children: source.files.map((file) => ({
      name: file.name,
      path: file.path,
      kind: "file" as const,
      mtime: file.mtime,
    })),
  };
}

/** Группы навигации по рантаймам: заголовок = рантайм, линия, подгруппы-папки. */
export function runtimeNavGroups(runtimes: RuntimeMemoryDTO[]): NavGroup[] {
  return runtimes.map((runtime) => ({
    key: runtime.id,
    label: runtime.displayName,
    hint: runtime.id,
    note:
      !runtime.supported || runtime.sources.length === 0 ? (
        <p className="text-xs text-fg-faint">{runtime.note ?? "memory-файлы не найдены"}</p>
      ) : undefined,
    nodes: runtime.sources.map(sourceNodes),
  }));
}
