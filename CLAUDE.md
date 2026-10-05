@AGENTS.md

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

<!-- OPENWIKI:START -->

## OpenWiki

@AGENTS.md

<!-- OPENWIKI:END -->

<!-- harness-design:start -->
# Дизайн-контекст Harness (harness)

Визуальная идентичность проекта: @DESIGN.md (формат @google/design.md: токены + гайд).
Правила интерфейса: design/ui-kit.md. Реестр компонентов: design/components.json (web и mobile).

Правила:
- Код web и mobile ведётся по токенам DESIGN.md и примитивам кита проекта; хардкод цветов и радиусов не применяется.
- Новые компоненты добавляются в кит проекта и в design/components.json (платформа web или mobile).
- design/ui-kit.md старше этого блока не приоритетен: при расхождении источник истины - DESIGN.md.
Дизайн-MCP этого проекта: open-design, figma (проектный .mcp.json).
<!-- harness-design:end -->
