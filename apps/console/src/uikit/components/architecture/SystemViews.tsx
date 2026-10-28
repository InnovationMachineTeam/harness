"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, cx, Input, Notice } from "@/uikit";
import {
  DATA_EDGES,
  DATA_NODES,
  FLOWS,
  SYSTEM_EDGES,
  SYSTEM_NODES,
  VIEW_GROUP_BY_ID,
  VIEW_GROUPS,
  type DataNode,
  type SystemNode,
  type ViewGroupId,
} from "./views";

type StageNode = SystemNode | DataNode;

const STAGE_W = 1180;
const STAGE_H = 700;

function edgePath(a: StageNode, b: StageNode): string {
  const p1 = { x: a.x + 88, y: a.y + 43 };
  const p2 = { x: b.x + 88, y: b.y + 43 };
  const mx = (p1.x + p2.x) / 2;
  return `M ${p1.x} ${p1.y} C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x} ${p2.y}`;
}

function StageCard({
  node,
  selected,
  dimmed,
  onSelect,
}: {
  node: StageNode;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const group = VIEW_GROUP_BY_ID[node.group];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={cx(
        "absolute w-44 overflow-hidden rounded-md border bg-surface p-3 text-left shadow-md transition-all hover:-translate-y-0.5",
        selected && "-translate-y-0.5",
        dimmed && "opacity-15",
      )}
      style={{
        left: node.x,
        top: node.y,
        borderColor: group.color,
        boxShadow: selected ? `0 0 0 1px ${group.color}` : undefined,
      }}
    >
      <span className="absolute -left-px -top-px h-[3px] w-7" style={{ background: group.color }} />
      <div className="font-mono text-[10px]" style={{ color: group.color }}>
        {group.label}
      </div>
      <div className="mt-1.5 text-sm font-semibold leading-tight">{node.title}</div>
      <div className="mt-1 text-[11px] leading-snug text-fg-muted">{node.subtitle}</div>
    </button>
  );
}

/** Канва с абсолютно позиционными карточками и SVG-рёбрами (представления "Система" и "Данные"). */
function StageView({ nodes, edges }: { nodes: StageNode[]; edges: [string, string][] }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewGroupId | "all">("all");
  const [query, setQuery] = useState("");
  const [scale, setScale] = useState(0.8);

  const fit = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    setScale(Math.min(1, (el.clientWidth - 24) / STAGE_W, (el.clientHeight - 24) / STAGE_H));
  }, []);
  useEffect(() => {
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return new Set(
      nodes
        .filter(
          (n) =>
            (filter === "all" || n.group === filter) &&
            (!q || `${n.title} ${n.subtitle} ${n.responsibility} ${n.source}`.toLowerCase().includes(q)),
        )
        .map((n) => n.id),
    );
  }, [nodes, filter, query]);

  const selected = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null;
  const related = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set([selectedId]);
    edges.forEach(([a, b]) => {
      if (a === selectedId) ids.add(b);
      if (b === selectedId) ids.add(a);
    });
    return ids;
  }, [selectedId, edges]);

  const selectedGroup = selected ? VIEW_GROUP_BY_ID[selected.group] : null;
  const relatedIds = selected ? [...(related ?? [])].filter((id) => id !== selectedId) : [];
  const clear = useCallback(() => setSelectedId(null), []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: узел, источник" className="w-56" />
        <Chip tone={filter === "all" ? "emerald" : "neutral"} onClick={() => setFilter("all")}>
          Все контуры
        </Chip>
        {VIEW_GROUPS.map((g) => (
          <Chip
            key={g.id}
            tone={filter === g.id ? "emerald" : "neutral"}
            title={`Контур "${g.label}"`}
            onClick={() => setFilter(filter === g.id ? "all" : g.id)}
          >
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: g.color }} />
            {g.label}
          </Chip>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => setScale((s) => Math.max(0.58, Math.round((s - 0.1) * 100) / 100))}>
            −
          </Button>
          <span className="w-10 text-center font-mono text-[10px] text-fg-faint">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="xs" onClick={() => setScale((s) => Math.min(1.35, Math.round((s + 0.1) * 100) / 100))}>
            +
          </Button>
          <Button variant="ghost" size="xs" onClick={fit}>
            Вписать
          </Button>
        </span>
      </div>
      <div
        ref={shellRef}
        className="relative flex h-[560px] items-center justify-center overflow-hidden rounded-xl border border-line bg-page"
        onClick={clear}
      >
        <div style={{ width: STAGE_W * scale, height: STAGE_H * scale }} className="relative shrink-0">
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} aria-hidden="true">
              <defs>
                <marker id="arch-view-arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: "var(--design-line-strong)" }} />
                </marker>
                <marker id="arch-view-arrow-active" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: "var(--design-fg)" }} />
                </marker>
              </defs>
              {edges.map(([from, to]) => {
                const a = nodes.find((n) => n.id === from);
                const b = nodes.find((n) => n.id === to);
                if (!a || !b) return null;
                const active = Boolean(selectedId && (from === selectedId || to === selectedId));
                const dimmed = matches.size !== nodes.length && !matches.has(from) && !matches.has(to);
                return (
                  <path
                    key={`${from}-${to}`}
                    d={edgePath(a, b)}
                    fill="none"
                    markerEnd={`url(#arch-view-arrow${active ? "-active" : ""})`}
                    style={{
                      stroke: active ? "var(--design-fg)" : "var(--design-line-strong)",
                      strokeWidth: active ? 2 : 1.2,
                      opacity: dimmed ? 0.08 : active ? 1 : 0.7,
                    }}
                  />
                );
              })}
            </svg>
            {nodes.map((n) => (
              <StageCard
                key={n.id}
                node={n}
                selected={selectedId === n.id}
                dimmed={matches.size !== nodes.length && !matches.has(n.id)}
                onSelect={() => setSelectedId(n.id)}
              />
            ))}
          </div>
        </div>
        {selected ? (
          <div
            className="absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-[340px] overflow-y-auto rounded-xl border border-line-strong bg-overlay p-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b border-line pb-2.5">
              <div>
                <div className="font-mono text-[10px]" style={{ color: selectedGroup?.color }}>
                  {selectedGroup?.label}
                </div>
                <h2 className="mt-1 text-lg font-semibold leading-tight">{selected.title}</h2>
              </div>
              <button
                type="button"
                aria-label="Закрыть карточку"
                className="rounded px-1 text-xs text-fg-faint transition-colors hover:text-fg"
                onClick={clear}
              >
                ✕
              </button>
            </div>
            <span
              className="mt-2.5 inline-block border px-1.5 py-0.5 font-mono text-[10px]"
              style={{ color: selectedGroup?.color, borderColor: selectedGroup?.color }}
            >
              {selected.subtitle}
            </span>
            <div className="mt-2.5 border-t border-line pt-2.5">
              <h3 className="text-[11px] font-semibold text-fg-muted">Ответственность</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{selected.responsibility}</p>
            </div>
            <div className="mt-2.5 border-t border-line pt-2.5">
              <h3 className="text-[11px] font-semibold text-fg-muted">Владелец данных</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{selected.owner}</p>
            </div>
            <div className="mt-2.5 border-t border-line pt-2.5">
              <h3 className="text-[11px] font-semibold text-fg-muted">Отказ и восстановление</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{selected.failure}</p>
            </div>
            <div className="mt-2.5 border-t border-line pt-2.5">
              <h3 className="text-[11px] font-semibold text-fg-muted">Источник</h3>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-info">{selected.source}</p>
            </div>
            <div className="mt-2.5 border-t border-line pt-2.5">
              <h3 className="text-[11px] font-semibold text-fg-muted">Связанные компоненты</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {relatedIds.length > 0 ? (
                  relatedIds.map((id) => {
                    const r = nodes.find((n) => n.id === id);
                    return r ? (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSelectedId(id)}
                        className="rounded border border-line px-1.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-info hover:text-info"
                      >
                        {r.title}
                      </button>
                    ) : null;
                  })
                ) : (
                  <span className="text-[11px] text-fg-faint">нет прямых связей</span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Представление "Потоки": четыре сквозных сценария как цепочки шагов. */
function FlowsView() {
  const [flowId, setFlowId] = useState(FLOWS[0].id);
  const flow = FLOWS.find((f) => f.id === flowId) ?? FLOWS[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FLOWS.map((f) => (
          <Chip key={f.id} tone={f.id === flowId ? "emerald" : "neutral"} onClick={() => setFlowId(f.id)}>
            {f.title}
          </Chip>
        ))}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{flow.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">{flow.description}</p>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        {flow.steps.map((step, i) => {
          const group = VIEW_GROUP_BY_ID[step.group];
          return (
            <Fragment key={step.id}>
              {i > 0 ? <span className="self-center text-fg-faint">→</span> : null}
              <div
                className="relative min-w-[170px] flex-1 overflow-hidden rounded-lg border bg-surface p-3"
                style={{ borderColor: group.color }}
              >
                <span className="absolute -left-px -top-px h-[3px] w-7" style={{ background: group.color }} />
                <div className="font-mono text-[10px]" style={{ color: group.color }}>
                  {group.label} · шаг {i + 1}
                </div>
                <div className="mt-1.5 text-sm font-semibold leading-tight">{step.title}</div>
                <div className="mt-1 font-mono text-[10px] leading-snug text-fg-muted">{step.subtitle}</div>
              </div>
            </Fragment>
          );
        })}
      </div>
      <Notice>
        Ошибка на шаге останавливает поток или переводит его в контролируемый fallback; последний шаг фиксирует результат и
        делает его наблюдаемым. Подробности потоков - в docs/architecture.md ("Основные сквозные потоки").
      </Notice>
    </div>
  );
}

/** Представления "Система" и "Данные" вкладки "Архитектура". */
export function SystemViews({ view }: { view: "system" | "flows" | "data" }) {
  if (view === "flows") return <FlowsView />;
  if (view === "data") return <StageView nodes={DATA_NODES} edges={DATA_EDGES} />;
  return <StageView nodes={SYSTEM_NODES} edges={SYSTEM_EDGES} />;
}
