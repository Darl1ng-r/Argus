import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { GraphCanvas } from './components/GraphCanvas';
import { SidePanel } from './components/SidePanel';
import { Legend } from './components/Legend';
import { Toast } from './components/Toast';
import { Topic, ClaimNode, ViewMode, EdgeType } from './types';

export const App: React.FC = () => {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Fetch initial topic
  useEffect(() => {
    fetchTopic('mars-vs-earth');
  }, []);

  const fetchTopic = async (id: string) => {
    try {
      const res = await fetch(`/api/topics/${id}`);
      if (res.ok) {
        const data = await res.json();
        setTopic(data);
      }
    } catch (err) {
      console.error('Failed to fetch topic from API', err);
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((current) => (current === msg ? null : current));
    }, 2800);
  };

  const handleVote = async (nodeId: string, voteType: 'support' | 'contest') => {
    if (!topic) return;

    // Optimistic UI update
    setTopic((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const newSupport = voteType === 'support' ? n.support + 1 : n.support;
          const newContest = voteType === 'contest' ? n.contest + 1 : n.contest;
          const isSteel = n.edgeType === 'root' || newSupport > newContest * 1.8;
          return { ...n, support: newSupport, contest: newContest, steel: isSteel };
        })
      };
    });

    try {
      await fetch(`/api/topics/${topic.id}/nodes/${nodeId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voteType })
      });
    } catch (err) {
      console.error('Failed to submit vote to backend', err);
    }
  };

  const handleAddClaim = async (parentId: string, edgeType: EdgeType, content: string) => {
    if (!topic) return;

    try {
      const res = await fetch(`/api/topics/${topic.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, edgeType, content })
      });

      if (res.ok) {
        const newNode: ClaimNode = await res.json();
        setTopic((prev) => (prev ? { ...prev, nodes: [...prev.nodes, newNode] } : null));
        setSelectedId(newNode.id);
        showToast('Claim added to the graph.');
      }
    } catch (err) {
      console.error('Failed to create node on backend', err);
    }
  };

  const handleFork = async () => {
    if (!topic) return;
    try {
      const res = await fetch(`/api/topics/${topic.id}/fork`, { method: 'POST' });
      if (res.ok) {
        const forkedTopic: Topic = await res.json();
        setTopic(forkedTopic);
        showToast('Forked — this graph now lives in your workspace.');
      }
    } catch (err) {
      console.error('Failed to fork topic', err);
    }
  };

  const handleUpdateNodePosition = (id: string, x: number, y: number) => {
    setTopic((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? { ...n, x, y } : n))
      };
    });
  };

  const selectedNode = topic?.nodes.find((n) => n.id === selectedId) || null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        topicTitle={topic?.title || 'Loading topic...'}
        viewMode={viewMode}
        onSelectViewMode={setViewMode}
        onFork={handleFork}
      />

      <div className="app">
        {viewMode === 'diff' ? (
          <div className="canvas-area">
            <div className="diff-empty show">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M8 3v18M16 3v18M4 8h4M16 8h4M4 16h4M16 16h4" />
              </svg>
              <h3>NO FORKS TO COMPARE, YET</h3>
              <p>
                Diff view lines up two people's argument graphs on the same topic, side by side, so you can see exactly where reasoning diverges.
              </p>
              <select disabled>
                <option>Select a fork to compare against…</option>
              </select>
            </div>
          </div>
        ) : (
          topic && (
            <GraphCanvas
              nodes={topic.nodes}
              selectedId={selectedId}
              viewMode={viewMode}
              onSelectNode={setSelectedId}
              onUpdateNodePosition={handleUpdateNodePosition}
            />
          )
        )}

        {viewMode !== 'diff' && <Legend />}

        <SidePanel
          selectedNode={selectedNode}
          onVote={handleVote}
          onAddClaim={handleAddClaim}
        />
      </div>

      <Toast message={toastMsg} />
    </div>
  );
};
