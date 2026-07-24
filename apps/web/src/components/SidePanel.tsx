import React, { useState } from 'react';
import { ClaimNode, EdgeType } from '../types';

const EDGE_META = {
  root: { label: 'ROOT CLAIM', color: '#B8892B' },
  supports: { label: 'SUPPORTS', color: '#6E7B4A' },
  refutes: { label: 'REFUTES', color: '#A2472E' },
  clarifies: { label: 'CLARIFIES', color: '#2E5C7A' },
  evidence: { label: 'NEEDS EVIDENCE', color: '#B8892B' }
};

interface SidePanelProps {
  selectedNode: ClaimNode | null;
  onVote: (nodeId: string, type: 'support' | 'contest') => void;
  onAddClaim: (parentId: string, edgeType: EdgeType, content: string) => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  selectedNode,
  onVote,
  onAddClaim
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [edgeType, setEdgeType] = useState<EdgeType>('supports');
  const [claimText, setClaimText] = useState('');

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimText.trim()) return;
    onAddClaim(selectedNode.id, edgeType, claimText.trim());
    setClaimText('');
    setIsFormOpen(false);
  };

  return (
    <aside>
      <h2>{selectedNode.edgeType === 'root' ? 'THE ROOT CLAIM' : 'SELECTED CLAIM'}</h2>
      <div id="panelBody">
        <div className="panel-eyebrow" style={{ color: meta.color }}>
          <span className="dot" style={{ background: meta.color }}></span>
          {meta.label}
        </div>

        <div className="panel-content">{selectedNode.content}</div>

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

        <div className="vote-row">
          <button
            className="vote-btn support"
            onClick={() => onVote(selectedNode.id, 'support')}
          >
            ▲ Support
          </button>
          <button
            className="vote-btn contest"
            onClick={() => onVote(selectedNode.id, 'contest')}
          >
            ▼ Contest
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
