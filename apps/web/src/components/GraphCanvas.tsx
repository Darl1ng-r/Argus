import React, { useEffect, useRef } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { ClaimNode, ViewMode } from '../types';

// Register dagre layout plugin with cytoscape
cytoscape.use(dagre);

interface GraphCanvasProps {
  nodes: ClaimNode[];
  selectedId: string | null;
  viewMode: ViewMode;
  onSelectNode: (id: string | null) => void;
  onUpdateNodePosition: (id: string, x: number, y: number) => void;
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // Initialize Cytoscape Instance
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      boxSelectionEnabled: false,
      autounselectify: false,
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            width: 240,
            height: 'label',
            padding: '16px',
            'background-color': '#FFFDF8',
            'border-width': 2,
            'border-color': '#DED6C3',
            'border-opacity': 1,
            color: '#2B2622',
            'font-family': 'Crimson Pro, serif',
            'font-size': '14px',
            'line-height': 1.35,
            'text-wrap': 'wrap',
            'text-max-width': '210px',
            'text-valign': 'center',
            'text-halign': 'center',
            content: 'data(label)',
            'overlay-opacity': 0,
            'transition-property': 'background-color, border-color, opacity',
            'transition-duration': 200,
          },
        },
        {
          selector: 'node[edgeType = "root"]',
          style: {
            'border-color': '#B8892B',
            'border-width': 3,
            'font-family': 'Cinzel, serif',
            'font-size': '14.5px',
            'background-color': '#FFFDF8',
          },
        },
        {
          selector: 'node[edgeType = "supports"]',
          style: {
            'border-color': '#6E7B4A',
          },
        },
        {
          selector: 'node[edgeType = "refutes"]',
          style: {
            'border-color': '#A2472E',
          },
        },
        {
          selector: 'node[edgeType = "clarifies"]',
          style: {
            'border-color': '#2E5C7A',
          },
        },
        {
          selector: 'node[edgeType = "evidence"]',
          style: {
            'border-color': '#B8892B',
            'border-style': 'dashed',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#B8892B',
            'border-width': 4,
            'background-color': '#FFFDF8',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.2,
            opacity: 0.8,
          },
        },
        {
          selector: 'edge[type = "supports"]',
          style: {
            'line-color': '#6E7B4A',
            'target-arrow-color': '#6E7B4A',
          },
        },
        {
          selector: 'edge[type = "refutes"]',
          style: {
            'line-color': '#A2472E',
            'target-arrow-color': '#A2472E',
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
            'line-color': '#B8892B',
            'target-arrow-color': '#B8892B',
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

    return () => {
      cy.destroy();
    };
  }, []);

  // Update Cytoscape Graph Elements on Node/ViewMode updates
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // Build elements array
      const elements: cytoscape.ElementDefinition[] = [];

      nodes.forEach((n) => {
        elements.push({
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
          elements.push({
            data: {
              id: `e_${n.parent}_${n.id}`,
              source: n.parent,
              target: n.id,
              type: n.edgeType,
            },
          });
        }
      });

      // Synchronize Cytoscape collection
      cy.json({ elements });

      // Apply Steelman Mode classes
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

      // Selection state
      cy.nodes().unselect();
      if (selectedId) {
        const sel = cy.getElementById(selectedId);
        if (sel) {
          sel.select();
          cy.animate({
            center: { eles: sel },
            zoom: Math.max(cy.zoom(), 0.95),
            duration: 350,
          });
        }
      }
    });
  }, [nodes, selectedId, viewMode]);

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
          background: 'var(--marble)',
          cursor: 'grab',
        }}
      />

      {/* Canvas Controls */}
      <div className="zoom-ctrl">
        <button onClick={handleZoomIn} title="Zoom In">+</button>
        <button onClick={handleZoomOut} title="Zoom Out">−</button>
        <button onClick={handleResetZoom} title="Fit to Screen" style={{ fontSize: '11px' }}>⟲</button>
        <button
          onClick={handleAutoLayout}
          title="Auto-organize DAG layout with Cytoscape Dagre"
          style={{ fontSize: '10px', fontWeight: 600, padding: '0 6px', width: 'auto' }}
        >
          Auto Layout
        </button>
      </div>
    </div>
  );
};
