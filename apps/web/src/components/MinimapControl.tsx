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
        background: 'rgba(255, 253, 248, 0.94)',
        border: '1px solid var(--marble-line, #DED6C3)',
        borderRadius: '10px',
        boxShadow: '0 8px 20px rgba(43, 38, 34, 0.08)',
        backdropFilter: 'blur(8px)',
        zIndex: 50,
        overflow: 'hidden',
        cursor: 'crosshair',
        transition: 'box-shadow 0.15s ease',
      }}
      title="Graph Radar Minimap — Click any node dot to navigate"
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 12px 28px rgba(43, 38, 34, 0.14)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '0 8px 20px rgba(43, 38, 34, 0.08)')}
    >
      <div
        style={{
          position: 'absolute',
          top: '5px',
          left: '8px',
          fontSize: '9px',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 800,
          letterSpacing: '0.1em',
          color: 'var(--gold, #8F6414)',
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
              ? '#8F6414'
              : node.edgeType === 'supports'
              ? '#5B693A'
              : node.edgeType === 'refutes'
              ? '#9B3333'
              : '#2E5C7A';

          return (
            <circle
              key={node.id}
              cx={Math.max(6, Math.min(mapWidth - 6, cx))}
              cy={Math.max(6, Math.min(mapHeight - 6, cy))}
              r={isSelected ? 5.5 : 3.5}
              fill={fill}
              stroke={isSelected ? '#2B2622' : 'none'}
              strokeWidth={isSelected ? 1.5 : 0}
              onClick={() => onSelectNode(node.id)}
              style={{ cursor: 'pointer', transition: 'r 0.15s' }}
            />
          );
        })}
      </svg>
    </div>
  );
};
