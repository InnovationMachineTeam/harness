import { registerRuntimePlugin } from "./registry";

// UI-метаданные рантаймов: подключение нового - файл + строка в index.ts.

registerRuntimePlugin({
  id: "claude",
  displayName: "Claude Code",
  monogram: "Cl",
  monogramClass: "border-swatch-3/30 bg-swatch-3/15 text-swatch-3",
});

registerRuntimePlugin({
  id: "codex",
  displayName: "Codex CLI",
  monogram: "Cx",
  monogramClass: "border-info/30 bg-info/15 text-info",
});

registerRuntimePlugin({
  id: "zcode",
  displayName: "ZCode",
  monogram: "Z",
  monogramClass: "border-swatch-1/30 bg-swatch-1/15 text-swatch-1",
});

registerRuntimePlugin({
  id: "cursor",
  displayName: "Cursor",
  monogram: "Cu",
  monogramClass: "border-swatch-5/30 bg-swatch-5/15 text-swatch-5",
});

registerRuntimePlugin({
  id: "kimi",
  displayName: "Kimi Code",
  monogram: "Ki",
  monogramClass: "border-swatch-2/30 bg-swatch-2/15 text-swatch-2",
});

registerRuntimePlugin({
  id: "opencode",
  displayName: "OpenCode",
  monogram: "Oc",
  monogramClass: "border-swatch-4/30 bg-swatch-4/15 text-swatch-4",
});
