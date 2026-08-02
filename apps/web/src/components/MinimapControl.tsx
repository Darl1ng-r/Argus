import React from 'react';
import { ClaimNode } from '../types';

interface MinimapControlProps {
  nodes: ClaimNode[];
  selectedId: string | null;
  onSelectNode: (id: string) => void;
}

export const MinimapControl: React.FC<MinimapControlProps> = ({
  nodes,
  selectedId,
  onSelectNode,
}) => {
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return null;

  // Calculate bounding box of all nodes
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });

  const width = Math.max(maxX - minX + 300, 400);
  const height = Math.max(maxY - minY + 300, 400);

  const mapWidth = 160;
  const mapHeight = 120;

  const scaleX = mapWidth / width;
  const scaleY = mapHeight / height;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '24px',
        right: '24px',
        width: `${mapWidth}px`,
        height: `${mapHeight}px`,
        background: '#FFFDF8',
        border: '1.5px solid var(--marble-line, #DED6C3)',
        borderRadius: '8px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.1)',
        zIndex: 50,
        overflow: 'hidden',
        cursor: 'crosshair',
      }}
      title="Graph Radar Minimap — Click any node dot to navigate"
    >
      <div
        style={{
          position: 'absolute',
          top: '4px',
          left: '6px',
          fontSize: '9px',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--parchment, #A89070)',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        RADAR
      </div>

      <svg width={mapWidth} height={mapHeight} style={{ display: 'block' }}>
        {nodes.map((node) => {
          const cx = (node.x - minX + 150) * scaleX;
          const cy = (node.y - minY + 150) * scaleY;
          const isSelected = node.id === selectedId;

          const fill =
            node.edgeType === 'root'
              ? '#B8892B'
              : node.edgeType === 'supports'
              ? '#6E7B4A'
              : node.edgeType === 'refutes'
              ? '#A2472E'
              : '#2E5C7A';

          return (
            <circle
              key={node.id}
              cx={Math.max(6, Math.min(mapWidth - 6, cx))}
              cy={Math.max(6, Math.min(mapHeight - 6, cy))}
              r={isSelected ? 5 : 3.5}
              fill={fill}
              stroke={isSelected ? '#2B2622' : 'none'}
              strokeWidth={1.5}
              onClick={() => onSelectNode(node.id)}
              style={{ cursor: 'pointer', transition: 'r 0.15s' }}
            />
          );
        })}
      </svg>
    </div>
  );
};
