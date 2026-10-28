"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  Panel as FlowPanel,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Button, Chip, cx, Input } from "@/uikit";
import {
  ARCH_EDGES,
  ARCH_FLOWS,
  ARCH_LAYER_BY_ID,
  ARCH_LAYERS,
  ARCH_NODES,
  type ArchLayerId,
  type ArchNode,
  type ArchSide,
} from "./data";

const SIDE_POSITION: Record<ArchSide, Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

const SIDES: ArchSide[] = ["top", "bottom", "left", "right"];

function ArchNodeView({ data, selected }: NodeProps) {
  const node = data.node as ArchNode;
  const color = data.color as string;
  return (
    <div
      className={cx(
        "w-[210px] rounded-lg border bg-surface p-2.5 shadow-sm transition-colors",
        selected ? "border-accent" : "border-line-strong hover:border-info",
      )}
    >
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={SIDE_POSITION[side]}
          className="!h-1.5 !w-1.5 !rounded-full !border-0 !bg-line-strong"
        />
      ))}
      {SIDES.map((side) => (
        <Handle
          key={`${side}-t`}
          id={side}
          type="target"
          position={SIDE_POSITION[side]}
          className="!h-1.5 !w-1.5 !rounded-full !border-0 !bg-line-strong"
        />
      ))}
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-xs font-semibold">{node.title}</span>
      </div>
      <div className="mt-1 text-[10px] leading-snug text-fg-muted">{node.subtitle}</div>
    </div>
  );
}

const nodeTypes = { arch: ArchNodeView };

const initialNodes: Node[] = ARCH_NODES.map((n) => ({
  id: n.id,
  type: "arch",
  position: { x: n.x, y: n.y },
  data: { node: n, color: ARCH_LAYER_BY_ID[n.layer].color },
}));

const baseEdges: Edge[] = ARCH_EDGES.map((e) => ({
  id: `e-${e.from}-${e.to}`,
  source: e.from,
  target: e.to,
  sourceHandle: e.fromSide,
  targetHandle: e.toSide,
  type: "smoothstep",
  label: e.label,
  labelStyle: { fill: "var(--design-fg-muted)", fontSize: 9 },
  labelBgStyle: { fill: "var(--design-surface)", fillOpacity: 0.85 },
}));

/** Раздел "Архитектура": карта слоёв, узлов и сквозных потоков harness на React Flow. */
export function ArchitectureMap() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [layerFilter, setLayerFilter] = useState<ArchLayerId | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges);

  // Выборка поиска и фильтра слоя: узлы вне её приглушаются вместе со связями.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return new Set(
      ARCH_NODES.filter(
        (n) =>
          (!layerFilter || n.layer === layerFilter) &&
          (!q || [n.title, n.subtitle, n.description, ...n.files].join(" ").toLowerCase().includes(q)),
      ).map((n) => n.id),
    );
  }, [query, layerFilter]);
  const filtering = Boolean(query.trim()) || layerFilter !== null;

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({ ...n, style: { ...n.style, opacity: matches.has(n.id) ? 1 : 0.25 } })),
    );
  }, [matches, setNodes]);

  // Подсветка связей выбранного узла; вне выборки фильтра связи гаснут сильнее.
  useEffect(() => {
    setEdges((eds) =>
      eds.map((e) => {
        const selectedActive = !selectedId || e.source === selectedId || e.target === selectedId;
        const filterActive = matches.has(e.source) || matches.has(e.target);
        const highlighted = Boolean(selectedId) && selectedActive && filterActive;
        return {
          ...e,
          animated: highlighted,
          style: {
            stroke: highlighted ? "var(--design-accent)" : "var(--design-line-strong)",
            strokeWidth: highlighted ? 1.8 : 1.2,
            opacity: !filterActive ? 0.1 : selectedId && !selectedActive ? 0.25 : 1,
          },
        };
      }),
    );
  }, [selectedId, matches, setEdges]);

  const selected = selectedId ? ARCH_NODES.find((n) => n.id === selectedId) ?? null : null;

  const titleById = useMemo(() => Object.fromEntries(ARCH_NODES.map((n) => [n.id, n.title])), []);
  const incoming = useMemo(() => (selected ? ARCH_EDGES.filter((e) => e.to === selected.id) : []), [selected]);
  const outgoing = useMemo(() => (selected ? ARCH_EDGES.filter((e) => e.from === selected.id) : []), [selected]);

  const onNodeClick = useCallback((_: unknown, node: Node) => setSelectedId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: узел, файл, описание"
          className="w-64"
        />
        {ARCH_LAYERS.map((l) => (
          <Chip
            key={l.id}
            tone={layerFilter === l.id ? "emerald" : "neutral"}
            title={`Фильтр слоя "${l.title}"`}
            onClick={() => setLayerFilter(layerFilter === l.id ? null : l.id)}
          >
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
            {l.title}
          </Chip>
        ))}
        {filtering ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setQuery("");
              setLayerFilter(null);
            }}
          >
            Сбросить
          </Button>
        ) : null}
      </div>
      <div className="relative h-[660px] overflow-hidden rounded-xl border border-line bg-page">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={1.4}
          zoomOnScroll={false}
          panOnScroll
          nodesConnectable={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--design-line)" />
          <Controls position="bottom-right" showInteractive={false} />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeColor={(n) => (n.data.color as string) ?? "var(--design-line-strong)"}
            nodeStrokeColor="var(--design-line)"
            maskColor="color-mix(in srgb, var(--design-page) 70%, transparent)"
            bgColor="var(--design-surface)"
            className="!rounded-lg !border !border-line"
          />
          <FlowPanel position="top-left">
            <div className="rounded-lg border border-line bg-surface/90 p-2.5 backdrop-blur">
              <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-faint">Слои</div>
              <div className="flex flex-col gap-0.5">
                {ARCH_LAYERS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    title={`Фильтр слоя "${l.title}"`}
                    onClick={() => setLayerFilter(layerFilter === l.id ? null : l.id)}
                    className={cx(
                      "flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-raised/60",
                      layerFilter === l.id && "bg-accent/10",
                    )}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                    <span className={cx("text-[10px]", layerFilter === l.id ? "text-fg" : "text-fg-muted")}>{l.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </FlowPanel>
        </ReactFlow>
        {selected ? (
          <div className="absolute right-3 top-3 z-10 w-80 rounded-xl border border-line-strong bg-overlay p-3 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ARCH_LAYER_BY_ID[selected.layer].color }} />
                <span className="text-[10px] uppercase tracking-wide text-fg-faint">{ARCH_LAYER_BY_ID[selected.layer].title}</span>
              </div>
              <button
                type="button"
                aria-label="Закрыть карточку"
                className="rounded px-1 text-xs text-fg-faint transition-colors hover:text-fg"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </button>
            </div>
            <div className="mt-1 text-sm font-semibold">{selected.title}</div>
            <div className="text-[11px] text-fg-muted">{selected.subtitle}</div>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">{selected.description}</p>
            {selected.files.length > 0 ? (
              <div className="mt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-faint">Ключевые файлы</div>
                <ul className="flex flex-col gap-0.5">
                  {selected.files.map((f) => (
                    <li key={f} className="truncate font-mono text-[11px] text-info" title={f}>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {incoming.length + outgoing.length > 0 ? (
              <div className="mt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-faint">Связи</div>
                <ul className="flex flex-col gap-0.5">
                  {incoming.map((e) => (
                    <li key={`in-${e.from}`} className="text-[11px] text-fg-muted">
                      <span className="text-fg-faint">←</span> {titleById[e.from]}
                      {e.label ? <span className="text-fg-faint"> - {e.label}</span> : null}
                    </li>
                  ))}
                  {outgoing.map((e) => (
                    <li key={`out-${e.to}`} className="text-[11px] text-fg-muted">
                      <span className="text-fg-faint">→</span> {titleById[e.to]}
                      {e.label ? <span className="text-fg-faint"> - {e.label}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ARCH_FLOWS.map((f) => (
          <div key={f.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-raised font-mono text-[10px] text-fg-muted">
                {f.id}
              </span>
              <span className="text-xs font-semibold">{f.title}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-muted">{f.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
