import React, { useState, useRef, useEffect } from 'react';
import { ClaimNode, ViewMode } from '../types';

interface EdgeMeta {
  label: string;
  color: string;
  marker: string;
  dashed?: boolean;
}

const EDGE_META: Record<string, EdgeMeta> = {
  root: { label: 'ROOT CLAIM', color: '#B8892B', marker: 'arrow-gold' },
  supports: { label: 'SUPPORTS', color: '#6E7B4A', marker: 'arrow-laurel' },
  refutes: { label: 'REFUTES', color: '#A2472E', marker: 'arrow-oxide' },
  clarifies: { label: 'CLARIFIES', color: '#2E5C7A', marker: 'arrow-aegean' },
  evidence: { label: 'NEEDS EVIDENCE', color: '#B8892B', marker: 'arrow-gold', dashed: true }
};

interface GraphCanvasProps {
  nodes: ClaimNode[];
  selectedId: string | null;
  viewMode: ViewMode;
  onSelectNode: (id: string | null) => void;
  onUpdateNodePosition: (id: string, x: number, y: number) => void;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  selectedId,
  viewMode,
  onSelectNode,
  onUpdateNodePosition
}) => {
  const [zoom, setZoom] = useState(1);
  const [draggingNode, setDraggingNode] = useState<ClaimNode | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragMoved, setDragMoved] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const estimateHeight = (n: ClaimNode) => {
    const lines = Math.ceil(n.content.length / 30);
    return 60 + lines * 15;
  };

  // Auto-scroll / center canvas on target node when selectedId changes or on initial deep link load
  useEffect(() => {
    if (!selectedId || !containerRef.current) return;
    const targetNode = nodes.find((n) => n.id === selectedId);
    if (!targetNode) return;

    const container = containerRef.current;
    const nodeCenterX = (targetNode.x + 106) * zoom;
    const nodeCenterY = (targetNode.y + 60) * zoom;

    const scrollX = Math.max(0, nodeCenterX - container.clientWidth / 2);
    const scrollY = Math.max(0, nodeCenterY - container.clientHeight / 2);

    container.scrollTo({
      left: scrollX,
      top: scrollY,
      behavior: 'smooth'
    });
  }, [selectedId, nodes, zoom]);

  const handlePointerDown = (e: React.PointerEvent, node: ClaimNode) => {
    e.stopPropagation();
    setDraggingNode(node);
    setDragMoved(false);

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOffset({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    });
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!draggingNode || !wrapperRef.current) return;
      setDragMoved(true);
      const wrapRect = wrapperRef.current.getBoundingClientRect();
      const newX = (e.clientX - wrapRect.left) / zoom - dragOffset.x;
      const newY = (e.clientY - wrapRect.top) / zoom - dragOffset.y;
      onUpdateNodePosition(draggingNode.id, newX, newY);
    };

    const handlePointerUp = () => {
      if (draggingNode && !dragMoved) {
        onSelectNode(draggingNode.id);
      }
      setDraggingNode(null);
    };

    if (draggingNode) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingNode, dragOffset, zoom, dragMoved, onUpdateNodePosition, onSelectNode]);

  return (
    <div
      ref={containerRef}
      className="canvas-area"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).id === 'graph-wrapper') {
          onSelectNode(null);
        }
      }}
    >
      <div
        id="graph-wrapper"
        ref={wrapperRef}
        className={viewMode === 'steelman' ? 'mode-steelman' : ''}
        style={{ transform: `scale(${zoom})` }}
      >
        <svg className="edges" id="edgesSvg">
          <defs>
            <marker id="arrow-laurel" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#6E7B4A" />
            </marker>
            <marker id="arrow-oxide" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#A2472E" />
            </marker>
            <marker id="arrow-aegean" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#2E5C7A" />
            </marker>
            <marker id="arrow-gold" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#B8892B" />
            </marker>
          </defs>

          {nodes.map((n) => {
            if (!n.parent) return null;
            const parent = nodes.find((p) => p.id === n.parent);
            if (!parent) return null;

            const pw = parent.id === 'root' || parent.edgeType === 'root' ? 280 : 212;
            const ph = parent.id === 'root' || parent.edgeType === 'root' ? 108 : estimateHeight(parent);
            const start = { x: parent.x + pw / 2, y: parent.y + ph };
            const end = { x: n.x + 106, y: n.y };
            const midY = (start.y + end.y) / 2;
            const meta = EDGE_META[n.edgeType] || EDGE_META.supports;

            return (
              <path
                key={`edge-${n.id}`}
                className="edge"
                d={`M${start.x},${start.y} C${start.x},${midY} ${end.x},${midY} ${end.x},${end.y}`}
                stroke={meta.color}
                strokeWidth="1.75"
                fill="none"
                markerEnd={`url(#${meta.marker})`}
                strokeDasharray={meta.dashed ? '5,4' : undefined}
                style={{ opacity: 0.75 }}
              />
            );
          })}
        </svg>

        {nodes.map((n) => {
          const meta = EDGE_META[n.edgeType] || EDGE_META.supports;
          const wellSupported = n.support > n.contest * 1.8;
          const isSelected = n.id === selectedId;
          const isRoot = n.edgeType === 'root';

          return (
            <div
              key={n.id}
              className={`node ${isSelected ? 'selected' : ''} ${isRoot ? 'root' : ''}`}
              data-id={n.id}
              data-steel={n.steel ? '1' : '0'}
              style={{ left: `${n.x}px`, top: `${n.y}px` }}
              onPointerDown={(e) => handlePointerDown(e, n)}
            >
              <div className="eyebrow" style={{ color: meta.color }}>
                <span className="dot" style={{ background: meta.color }}></span>
                {meta.label}
              </div>
              <div className="content">{n.content}</div>

              {isRoot ? (
                <div className="columns">
                  <span></span><span></span><span></span><span></span><span></span><span></span>
                </div>
              ) : (
                <div className="meta">
                  {wellSupported ? (
                    <span className="laurel">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C9 6 7 10 7 14a5 5 0 0010 0c0-4-2-8-5-12z" />
                      </svg>
                      well-supported
                    </span>
                  ) : (
                    <span>
                      {n.support} · {n.contest}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="zoom-ctrl">
        <button onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}>+</button>
        <button onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}>−</button>
        <button onClick={() => setZoom(1)} style={{ fontSize: '11px' }}>
          ⟲
        </button>
      </div>
    </div>
  );
};
