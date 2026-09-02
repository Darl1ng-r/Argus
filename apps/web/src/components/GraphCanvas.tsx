import React, { useEffect, useRef } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { ClaimNode, ViewMode } from '../types';
import { MinimapControl } from './MinimapControl';

// Register dagre layout plugin with cytoscape
cytoscape.use(dagre);

interface GraphCanvasProps {
  nodes: ClaimNode[];
  selectedId: string | null;
  viewMode: ViewMode;
  onSelectNode: (id: string | null) => void;
  onUpdateNodePosition: (id: string, x: number, y: number) => void;
  onCyReady?: (cy: Core) => void;
}

const COLOR_MAP: Record<string, string> = {
  root: '#B8892B',
  supports: '#6E7B4A',
  refutes: '#A2472E',
  clarifies: '#2E5C7A',
  evidence: '#B8892B',
};

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  selectedId,
  viewMode,
  onSelectNode,
  onUpdateNodePosition,
  onCyReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const isInitialFitRef = useRef(false);

  // Initialize Cytoscape Instance
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      boxSelectionEnabled: false,
      autounselectify: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      wheelSensitivity: 0.25,
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            'corner-radius': '8px',
            width: 240,
            height: 'label',
            padding: '16px',
            'background-color': '#FFFDF8',
            'border-width': 2,
            'border-color': '#DED6C3',
            'border-opacity': 1,
            color: '#2B2622',
            'font-family': 'Crimson Pro, serif',
            'font-size': '14.5px',
            'line-height': 1.35,
            'text-wrap': 'wrap',
            'text-max-width': '210px',
            'text-valign': 'center',
            'text-halign': 'center',
            content: 'data(label)',
            'overlay-opacity': 0,
            'transition-property': 'background-color, border-color, opacity, underlay-opacity',
            'transition-duration': 150,
          },
        },
        {
          selector: 'node[edgeType = "root"]',
          style: {
            'border-color': '#8F6414',
            'border-width': 2.5,
            'corner-radius': '10px',
            'font-family': 'Cinzel, serif',
            'font-size': '14px',
            'font-weight': 'bold',
            'background-color': '#FFFDF8',
          },
        },
        {
          selector: 'node[edgeType = "supports"]',
          style: {
            'border-color': '#5B693A',
            'border-width': 2,
          },
        },
        {
          selector: 'node[edgeType = "refutes"]',
          style: {
            'border-color': '#9B3333',
            'border-width': 2,
          },
        },
        {
          selector: 'node[edgeType = "clarifies"]',
          style: {
            'border-color': '#2E5C7A',
            'border-width': 2,
          },
        },
        {
          selector: 'node[edgeType = "evidence"]',
          style: {
            'border-color': '#8F6414',
            'border-style': 'dashed',
            'border-width': 2,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#8F6414',
            'border-width': 3,
            'background-color': '#FFFDF8',
            'underlay-color': 'rgba(143, 100, 20, 0.2)',
            'underlay-padding': '6px',
            'underlay-opacity': 1,
            'underlay-shape': 'round-rectangle',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2.2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.15,
            opacity: 0.92,
            'z-index': 1,
          },
        },
        {
          selector: 'edge[type = "supports"]',
          style: {
            'line-color': '#5B693A',
            'target-arrow-color': '#5B693A',
          },
        },
        {
          selector: 'edge[type = "refutes"]',
          style: {
            'line-color': '#9B3333',
            'target-arrow-color': '#9B3333',
          },
        },
        {
          selector: 'edge[type = "clarifies"]',
          style: {
            'line-color': '#2E5C7A',
            'target-arrow-color': '#2E5C7A',
          },
        },
        {
          selector: 'edge[type = "evidence"]',
          style: {
            'line-color': '#8F6414',
            'target-arrow-color': '#8F6414',
            'line-style': 'dashed',
          },
        },
        // Steelman Mode Styling: Dim non-steel nodes
        {
          selector: '.dimmed',
          style: {
            opacity: 0.2,
          },
        },
      ],
    });

    // Event Handlers
    cy.on('tap', 'node', (evt: EventObject) => {
      const node = evt.target;
      onSelectNode(node.id());
    });

    cy.on('mouseover', 'node', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });

    cy.on('mouseout', 'node', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        onSelectNode(null);
      }
    });

    cy.on('dragfree', 'node', (evt: EventObject) => {
      const node = evt.target;
      const pos = node.position();
      onUpdateNodePosition(node.id(), pos.x, pos.y);
    });

    cyRef.current = cy;
    if (onCyReady) onCyReady(cy);

    // Keyboard Shortcuts Listener (+ / - / 0 / Esc)
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in text inputs or textareas
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === '+' || e.key === '=') {
        cy.zoom(cy.zoom() * 1.2);
      } else if (e.key === '-' || e.key === '_') {
        cy.zoom(cy.zoom() * 0.8);
      } else if (e.key === '0') {
        cy.fit(undefined, 50);
      } else if (e.key === 'Escape') {
        onSelectNode(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      cy.destroy();
    };
  }, []);

  // Fix #16 — Update Cytoscape Graph Elements with granular diffing
  // instead of cy.json({ elements }) which replaces the entire graph
  // and causes visual flashing + layout state loss on every update.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // --- Build desired elements set ---
      const desiredNodes = new Map<string, cytoscape.ElementDefinition>();
      const desiredEdges = new Map<string, cytoscape.ElementDefinition>();

      (nodes || []).forEach((n) => {
        desiredNodes.set(n.id, {
          data: {
            id: n.id,
            label: n.content,
            edgeType: n.edgeType,
            support: n.support,
            contest: n.contest,
            steel: n.steel,
          },
          position: { x: n.x, y: n.y },
        });

        if (n.parent) {
          const edgeId = `e_${n.parent}_${n.id}`;
          desiredEdges.set(edgeId, {
            data: {
              id: edgeId,
              source: n.parent,
              target: n.id,
              type: n.edgeType,
            },
          });
        }
      });

      // --- Remove stale elements ---
      cy.nodes().forEach((ele) => {
        if (!desiredNodes.has(ele.id())) cy.remove(ele);
      });
      cy.edges().forEach((ele) => {
        if (!desiredEdges.has(ele.id())) cy.remove(ele);
      });

      // --- Add new elements / update data on existing ones ---
      desiredNodes.forEach((def, id) => {
        const existing = cy.getElementById(id);
        if (existing.length === 0) {
          cy.add({ group: 'nodes', ...def });
        } else {
          // Update data in-place (avoids layout disruption)
          existing.data(def.data);
          // Only move if position changed significantly (avoids jitter from user drags)
          const cur = existing.position();
          const dx = Math.abs(cur.x - (def.position?.x ?? cur.x));
          const dy = Math.abs(cur.y - (def.position?.y ?? cur.y));
          if (dx > 1 || dy > 1) {
            existing.position(def.position as { x: number; y: number });
          }
        }
      });

      desiredEdges.forEach((def, id) => {
        const sourceExists = cy.getElementById(def.data.source).length > 0;
        const targetExists = cy.getElementById(def.data.target).length > 0;
        if (sourceExists && targetExists && cy.getElementById(id).length === 0) {
          cy.add({ group: 'edges', ...def });
        }
      });

      // --- Apply Steelman mode classes ---
      if (viewMode === 'steelman') {
        cy.nodes().forEach((ele) => {
          const isSteel = ele.data('steel');
          const isRoot = ele.data('edgeType') === 'root';
          if (!isSteel && !isRoot) {
            ele.addClass('dimmed');
          } else {
            ele.removeClass('dimmed');
          }
        });
      } else {
        cy.nodes().removeClass('dimmed');
      }

      // --- Selection state ---
      cy.nodes().unselect();
      if (selectedId) {
        const sel = cy.getElementById(selectedId);
        if (sel.length > 0) {
          sel.select();
        }
      }
    });

    // Auto-fit bounds on initial nodes load
    if (!isInitialFitRef.current && nodes && nodes.length > 0) {
      cy.fit(undefined, 60);
      isInitialFitRef.current = true;
    }
  }, [nodes, selectedId, viewMode]);

  // Smooth focus animation only when user selection ID changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedId) return;
    const sel = cy.getElementById(selectedId);
    if (sel.length > 0) {
      cy.animate({
        center: { eles: sel },
        zoom: Math.max(cy.zoom(), 0.95),
        duration: 250,
      });
    }
  }, [selectedId]);

  // Run Dagre Layout auto-positioning
  const handleAutoLayout = () => {
    const cy = cyRef.current;
    if (!cy) return;

    const layout = cy.layout({
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 70,
      rankSep: 90,
      padding: 50,
      animate: true,
      animationDuration: 450,
    } as any);

    layout.run();
  };

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.2);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleResetZoom = () => cyRef.current?.fit(undefined, 50);

  return (
    <div className="canvas-area" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          background: 'transparent',
          cursor: 'grab',
        }}
      />

      {/* Canvas Controls — Positioned neatly above the Radar minimap */}
      <div className="zoom-ctrl" aria-label="Graph navigation controls">
        <button onClick={handleZoomIn} title="Zoom In (+)">+</button>
        <button onClick={handleZoomOut} title="Zoom Out (−)">−</button>
        <button onClick={handleResetZoom} title="Fit Graph to Screen (Reset)">⟲</button>
        <button
          onClick={handleAutoLayout}
          title="Auto-organize DAG layout with Cytoscape Dagre"
          style={{ fontSize: '10.5px', fontWeight: 700, padding: '0 6px', width: 'auto', letterSpacing: '0.02em' }}
        >
          Layout
        </button>
      </div>

      {/* Radar Minimap Navigation */}
      <MinimapControl
        nodes={nodes}
        selectedId={selectedId}
        onSelectNode={(id) => onSelectNode(id)}
      />

      {/* Screen Reader & Keyboard Accessible Tree Outline Layer */}
      <div
        className="sr-only-tree"
        role="tree"
        aria-label="Debate claims argument tree"
        tabIndex={0}
      >
        <div style={{ fontWeight: 700, marginBottom: '8px', fontFamily: 'Cinzel, serif', fontSize: '13px', color: 'var(--gold)' }}>
          DEBATE GRAPH OUTLINE (KEYBOARD ACCESSIBLE)
        </div>
        {nodes.map((node, index) => {
          const isSelected = node.id === selectedId;
          const relation = node.edgeType === 'root' ? 'Root Claim' : `${node.edgeType} parent`;
          return (
            <div
              key={node.id}
              role="treeitem"
              id={`sr-node-${node.id}`}
              aria-selected={isSelected}
              tabIndex={isSelected || (index === 0 && !selectedId) ? 0 : -1}
              onClick={() => onSelectNode(node.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectNode(node.id);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const next = nodes[index + 1];
                  if (next) {
                    onSelectNode(next.id);
                    document.getElementById(`sr-node-${next.id}`)?.focus();
                  }
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const prev = nodes[index - 1];
                  if (prev) {
                    onSelectNode(prev.id);
                    document.getElementById(`sr-node-${prev.id}`)?.focus();
                  }
                }
              }}
              className="sr-tree-item"
            >
              <div>
                <strong>[{relation.toUpperCase()}]</strong> {node.content}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>
                Support: {node.support} | Contest: {node.contest}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
