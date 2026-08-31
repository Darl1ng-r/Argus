import React, { useState, useEffect, useRef } from 'react';
import { ClaimNode } from '../types';

interface NodeSearchModalProps {
  isOpen: boolean;
  nodes: ClaimNode[];
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export const NodeSearchModal: React.FC<NodeSearchModalProps> = ({
  isOpen,
  nodes,
  onClose,
  onSelectNode,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = nodes.filter((n) =>
    n.content.toLowerCase().includes(query.toLowerCase().trim())
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(43, 38, 34, 0.4)',
        backdropFilter: 'blur(3px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#FFFDF8',
          border: '1px solid var(--marble-line, #DED6C3)',
          borderRadius: '12px',
          maxWidth: '560px',
          width: '100%',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid var(--marble-line, #DED6C3)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'var(--marble-panel, #F8F4ED)',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search claims by content or keyword… (Esc to close)"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontFamily: 'Inter, sans-serif',
              fontSize: '15px',
              color: 'var(--ink, #2B2622)',
            }}
          />
          <span
            style={{
              fontSize: '11px',
              fontFamily: 'Inter, sans-serif',
              color: 'var(--parchment, #A89070)',
              background: '#FFFDF8',
              padding: '3px 8px',
              borderRadius: '4px',
              border: '1px solid var(--marble-line, #DED6C3)',
            }}
          >
            ESC
          </span>
        </div>

        {/* Results List */}
        <div style={{ maxHeight: '350px', overflowY: 'auto', padding: '8px 0' }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                fontFamily: 'Inter, sans-serif',
                fontSize: '13.5px',
                color: 'var(--ink-soft, #5A524A)',
              }}
            >
              No matching claims found in this debate.
            </div>
          ) : (
            filtered.map((node) => (
              <div
                key={node.id}
                onClick={() => {
                  onSelectNode(node.id);
                  onClose();
                }}
                style={{
                  padding: '12px 20px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--marble-line, #F3ECE0)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--marble-panel, #F8F4ED)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color:
                        node.edgeType === 'root'
                          ? '#B8892B'
                          : node.edgeType === 'supports'
                          ? '#6E7B4A'
                          : node.edgeType === 'refutes'
                          ? '#A2472E'
                          : '#2E5C7A',
                    }}
                  >
                    {node.edgeType}
                  </span>
                  {node.steel && (
                    <span style={{ fontSize: '10px', color: 'var(--gold, #B8892B)' }}>
                      ★ Steelman
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: 'Crimson Pro, serif',
                    fontSize: '15px',
                    color: 'var(--ink, #2B2622)',
                    lineHeight: 1.35,
                  }}
                >
                  "{node.content}"
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
