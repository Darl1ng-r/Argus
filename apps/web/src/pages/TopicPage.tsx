import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { GraphCanvas } from '../components/GraphCanvas';
import { SidePanel } from '../components/SidePanel';
import { Legend } from '../components/Legend';
import { Toast } from '../components/Toast';
import { Topic, ClaimNode, ViewMode, EdgeType, User } from '../types';

interface TopicPageProps {
  currentUser: User | null;
  onSwitchUser: () => void;
}

export const TopicPage: React.FC<TopicPageProps> = ({ currentUser, onSwitchUser }) => {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const getAuthHeaders = useCallback(() => {
    const userId = localStorage.getItem('argus_user_id') || 'system';
    const userName = localStorage.getItem('argus_user_name') || 'system';
    return {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-User-Name': userName
    };
  }, []);

  const fetchTopic = useCallback(async (id: string) => {
    setIsLoading(true);
    setNotFound(false);

    try {
      const res = await fetch(`/api/topics/${id}`, {
        headers: getAuthHeaders()
      });

      if (res.ok) {
        const data = await res.json();
        setTopic(data);
      } else if (res.status === 404) {
        setNotFound(true);
      }
    } catch (err) {
      console.error('Failed to fetch topic', err);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (topicId) {
      fetchTopic(topicId);
    }
  }, [topicId, fetchTopic]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((current) => (current === msg ? null : current));
    }, 2800);
  };

  const handleVote = async (nodeId: string, voteType: 'support' | 'contest') => {
    if (!topic || !currentUser) return;

    try {
      const res = await fetch(`/api/topics/${topic.id}/nodes/${nodeId}/vote`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ voteType })
      });

      if (res.ok) {
        const updatedNode: ClaimNode = await res.json();
        setTopic((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            nodes: prev.nodes.map((n) => (n.id === nodeId ? updatedNode : n))
          };
        });

        if (updatedNode.userVote) {
          showToast(`Vote recorded as ${updatedNode.userVote.toUpperCase()}.`);
        } else {
          showToast('Vote removed.');
        }
      }
    } catch (err) {
      console.error('Failed to submit vote to backend', err);
    }
  };

  const handleAddClaim = async (parentId: string, edgeType: EdgeType, content: string) => {
    if (!topic) return;

    try {
      const res = await fetch(`/api/topics/${topic.id}/nodes`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ parentId, edgeType, content })
      });

      if (res.ok) {
        const newNode: ClaimNode = await res.json();
        setTopic((prev) => (prev ? { ...prev, nodes: [...prev.nodes, newNode] } : null));
        setSelectedId(newNode.id);
        showToast('Claim added to the graph.');
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Failed to add claim.');
      }
    } catch (err) {
      console.error('Failed to create node on backend', err);
    }
  };

  const handleFork = async () => {
    if (!topic) return;
    try {
      const res = await fetch(`/api/topics/${topic.id}/fork`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (res.ok) {
        const forkedTopic: Topic = await res.json();
        showToast('Forked — redirecting to your new debate workspace…');
        setTimeout(() => navigate(`/t/${forkedTopic.id}`), 1000);
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

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--marble)', color: 'var(--ink-soft)', fontFamily: 'Cinzel, serif' }}>
        LOADING ARGUMENT GRAPH…
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--marble)', color: 'var(--ink)' }}>
        <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '22px', marginBottom: '12px' }}>DEBATE NOT FOUND</h2>
        <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '16px', color: 'var(--ink-soft)', marginBottom: '20px' }}>
          This argument graph does not exist or has been archived.
        </p>
        <button className="fork-btn" onClick={() => navigate('/')}>
          ← Back to Debates
        </button>
      </div>
    );
  }

  const selectedNode = topic?.nodes.find((n) => n.id === selectedId) || null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header with Back to Home Link */}
      <div style={{ background: 'var(--marble-panel)', padding: '6px 28px', borderBottom: '1px solid var(--marble-line)', display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontSize: '12px',
            color: 'var(--aegean)',
            cursor: 'pointer',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          ← All Debates
        </button>
      </div>

      <Header
        topicTitle={topic?.title || 'Argument Graph'}
        viewMode={viewMode}
        user={currentUser}
        onSelectViewMode={setViewMode}
        onFork={handleFork}
        onSwitchUser={onSwitchUser}
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
          currentUser={currentUser}
          onVote={handleVote}
          onAddClaim={handleAddClaim}
        />
      </div>

      <Toast message={toastMsg} />
    </div>
  );
};
