import React, { useState } from 'react';
import { ClaimNode, EdgeType, User } from '../types';
import { LinkPreviewCard } from './LinkPreviewCard';

// Helper to extract first URL from claim text
function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

const EDGE_META = {
  root: { label: 'ROOT CLAIM', color: '#B8892B' },
  supports: { label: 'SUPPORTS', color: '#6E7B4A' },
  refutes: { label: 'REFUTES', color: '#A2472E' },
  clarifies: { label: 'CLARIFIES', color: '#2E5C7A' },
  evidence: { label: 'NEEDS EVIDENCE', color: '#B8892B' }
};

interface SidePanelProps {
  selectedNode: ClaimNode | null;
  currentUser: User | null;
  onVote: (nodeId: string, type: 'support' | 'contest') => void;
  onAddClaim: (parentId: string, edgeType: EdgeType, content: string) => void;
  onEditClaim?: (nodeId: string, newContent: string) => void;
  onDeleteClaim?: (nodeId: string) => void;
  onShareLink?: () => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  selectedNode,
  currentUser,
  onVote,
  onAddClaim,
  onEditClaim,
  onDeleteClaim,
  onShareLink
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [edgeType, setEdgeType] = useState<EdgeType>('supports');
  const [claimText, setClaimText] = useState('');

  // Edit claim state
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  if (!selectedNode) {
    return (
      <aside>
        <h2>SELECTED CLAIM</h2>
        <div id="panelBody">
          <p className="panel-empty">
            Select a stele on the marble to inspect its standing, or add a claim of your own to the discussion.
          </p>
        </div>
      </aside>
    );
  }

  const meta = EDGE_META[selectedNode.edgeType] || EDGE_META.supports;
  const total = selectedNode.support + selectedNode.contest;
  const supportPct = total > 0 ? Math.round((selectedNode.support / total) * 100) : 50;
  const contestPct = 100 - supportPct;

  const userVote = selectedNode.userVote;
  const detectedUrl = extractFirstUrl(selectedNode.content);

  const isAuthorOrOwner = currentUser && selectedNode.authorId === currentUser.id;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimText.trim()) return;
    onAddClaim(selectedNode.id, edgeType, claimText.trim());
    setClaimText('');
    setIsFormOpen(false);
  };

  const handleStartEdit = () => {
    setEditText(selectedNode.content);
    setIsEditing(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editText.trim() || !onEditClaim) return;
    onEditClaim(selectedNode.id, editText.trim());
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!onDeleteClaim) return;
    if (window.confirm('Are you sure you want to delete this claim? (Claims with replies cannot be deleted)')) {
      onDeleteClaim(selectedNode.id);
    }
  };

  return (
    <aside aria-label="Claim Details and Dialectic Discussion">
      <div className="sheet-handle" aria-hidden="true" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid var(--marble-line)' }}>
        <h2 style={{ margin: 0, padding: 0, border: 'none' }}>
          {selectedNode.edgeType === 'root' ? 'THE ROOT CLAIM' : 'SELECTED CLAIM'}
        </h2>

        <div style={{ display: 'flex', gap: '6px' }}>
          {onShareLink && (
            <button
              onClick={onShareLink}
              title="Copy deep link URL for this claim"
              style={{
                background: 'transparent',
                border: '1px solid var(--marble-line)',
                borderRadius: '4px',
                padding: '3px 8px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '11px',
                color: 'var(--aegean)',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Share
            </button>
          )}

          {isAuthorOrOwner && onEditClaim && selectedNode.edgeType !== 'root' && (
            <button
              onClick={handleStartEdit}
              title="Edit claim content"
              style={{
                background: 'transparent',
                border: '1px solid var(--marble-line)',
                borderRadius: '4px',
                padding: '3px 8px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '11px',
                color: 'var(--gold)',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Edit
            </button>
          )}

          {isAuthorOrOwner && onDeleteClaim && selectedNode.edgeType !== 'root' && (
            <button
              onClick={handleDelete}
              title="Delete claim"
              style={{
                background: 'transparent',
                border: '1px solid #F2D5CE',
                borderRadius: '4px',
                padding: '3px 8px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '11px',
                color: 'var(--oxide)',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div id="panelBody">
        <div className="panel-eyebrow" style={{ color: meta.color }}>
          <span className="dot" style={{ background: meta.color }}></span>
          {meta.label}
          {selectedNode.authorUsername && (
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--ink-soft)', fontWeight: 400 }}>
              by @{selectedNode.authorUsername}
            </span>
          )}
        </div>

        {isEditing ? (
          <form onSubmit={handleSaveEdit} style={{ marginBottom: '14px' }}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '10px',
                fontFamily: 'Crimson Pro, serif',
                fontSize: '15px',
                borderRadius: '6px',
                border: '1px solid var(--gold)',
                background: '#FFFDF8',
                marginBottom: '8px',
                boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  border: '1px solid var(--marble-line)',
                  borderRadius: '4px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  padding: '4px 12px',
                  background: 'var(--gold)',
                  color: '#FFFDF8',
                  border: 'none',
                  borderRadius: '4px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Save Edit
              </button>
            </div>
          </form>
        ) : (
          <div className="panel-content">{selectedNode.content}</div>
        )}

        {detectedUrl && <LinkPreviewCard url={detectedUrl} />}

        <div className="score-row">
          <div className="score-label">
            <span>Support</span>
            <span>{selectedNode.support}</span>
          </div>
          <div className="score-track">
            <div className="score-fill support" style={{ width: `${supportPct}%` }}></div>
          </div>
        </div>

        <div className="score-row">
          <div className="score-label">
            <span>Contest</span>
            <span>{selectedNode.contest}</span>
          </div>
          <div className="score-track">
            <div className="score-fill contest" style={{ width: `${contestPct}%` }}></div>
          </div>
        </div>

        <div style={{ margin: '14px 0 6px', fontSize: '11px', color: 'var(--ink-soft)' }}>
          {userVote ? (
            <span>You voted: <b style={{ color: userVote === 'support' ? 'var(--support-bar)' : 'var(--contest-bar)' }}>{userVote.toUpperCase()}</b> (click again to undo)</span>
          ) : (
            <span>1 vote per user enforced</span>
          )}
        </div>

        <div className="vote-row">
          <button
            className={`vote-btn support ${userVote === 'support' ? 'active-vote' : ''}`}
            style={{
              background: userVote === 'support' ? 'var(--support-bar)' : '#FFFDF8',
              color: userVote === 'support' ? '#FFFDF8' : 'var(--support-bar)',
              borderColor: 'var(--support-bar)'
            }}
            onClick={() => onVote(selectedNode.id, 'support')}
          >
            {userVote === 'support' ? '✓ Supported' : '▲ Support'}
          </button>

          <button
            className={`vote-btn contest ${userVote === 'contest' ? 'active-vote' : ''}`}
            style={{
              background: userVote === 'contest' ? 'var(--contest-bar)' : '#FFFDF8',
              color: userVote === 'contest' ? '#FFFDF8' : 'var(--contest-bar)',
              borderColor: 'var(--contest-bar)'
            }}
            onClick={() => onVote(selectedNode.id, 'contest')}
          >
            {userVote === 'contest' ? '✓ Contested' : '▼ Contest'}
          </button>
        </div>

        <button className="add-toggle" onClick={() => setIsFormOpen(!isFormOpen)}>
          ＋ ADD A RESPONSE
        </button>

        <form className={`add-form ${isFormOpen ? 'open' : ''}`} onSubmit={handleSubmit}>
          <label>Relation to this claim</label>
          <select
            value={edgeType}
            onChange={(e) => setEdgeType(e.target.value as EdgeType)}
          >
            <option value="supports">Supports</option>
            <option value="refutes">Refutes</option>
            <option value="clarifies">Clarifies</option>
            <option value="evidence">Needs evidence</option>
          </select>

          <label>Your claim</label>
          <textarea
            value={claimText}
            onChange={(e) => setClaimText(e.target.value)}
            placeholder="State one claim, as plainly as you can…"
          />

          <button type="submit" className="submit-btn">
            Add to the graph
          </button>
        </form>
      </div>
    </aside>
  );
};
