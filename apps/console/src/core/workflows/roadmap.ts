import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { roadmapItemSchema, type RoadmapItem } from "./schema";

export async function listRoadmapItems(workspaceRoot: string): Promise<RoadmapItem[]> {
  const dir = path.join(workspaceRoot, ".agents", "roadmap", "items");
  const names = await readdir(dir).catch(() => [] as string[]);
  const items: RoadmapItem[] = [];
  for (const name of names.filter((value) => value.endsWith(".yaml")).sort()) {
    try {
      items.push(roadmapItemSchema.parse(YAML.parse(await readFile(path.join(dir, name), "utf8"))));
    } catch {
      // Повреждённая карточка не ломает всю доску.
    }
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveRoadmapItem(workspaceRoot: string, raw: unknown): Promise<RoadmapItem> {
  const item = roadmapItemSchema.parse(raw);
  const dir = path.join(workspaceRoot, ".agents", "roadmap", "items");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, item.id + ".yaml");
  const tmp = file + ".tmp";
  await writeFile(tmp, YAML.stringify(item, { lineWidth: 0 }), "utf8");
  await rename(tmp, file);
  return item;
}

export function findingFingerprint(title: string, source: string): string {
  return createHash("sha256").update(title.trim().toLowerCase() + "\n" + source).digest("hex").slice(0, 16);
}
