import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { GraphCanvas } from '../components/GraphCanvas';
import { SidePanel } from '../components/SidePanel';
import { Legend } from '../components/Legend';
import { Toast, ToastState } from '../components/Toast';
import { Topic, ClaimNode, ViewMode, EdgeType, User } from '../types';

interface TopicPageProps {
  currentUser: User | null;
  onSwitchUser: () => void;
}

export const TopicPage: React.FC<TopicPageProps> = ({ currentUser, onSwitchUser }) => {
  const { topicId } = useParams<{ topicId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Initialize ViewMode and SelectedNode from URL Query Parameters on load
  useEffect(() => {
    const modeParam = searchParams.get('mode') as ViewMode | null;
    if (modeParam && ['graph', 'steelman', 'diff'].includes(modeParam)) {
      setViewMode(modeParam);
    }

    const nodeParam = searchParams.get('node');
    if (nodeParam) {
      setSelectedId(nodeParam);
    }
  }, []);

  // Update URL Query Parameters whenever selectedId or viewMode changes
  const updateUrlParams = useCallback((nodeId: string | null, mode: ViewMode) => {
    const params: Record<string, string> = {};
    if (nodeId) params.node = nodeId;
    if (mode !== 'graph') params.mode = mode;
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  const handleSelectNode = (id: string | null) => {
    setSelectedId(id);
    updateUrlParams(id, viewMode);
  };

  const handleSelectViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    updateUrlParams(selectedId, mode);
  };

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
    setErrorMsg(null);
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
      } else {
        throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      console.error('Failed to fetch topic', err);
      setErrorMsg(
        err.message || 'Unable to connect to the Argus API server. Please check your connection or verify the server is running.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (topicId) {
      fetchTopic(topicId);
    }
  }, [topicId, fetchTopic]);

  // Real-time Collaboration via Server-Sent Events (SSE)
  useEffect(() => {
    if (!topicId) return;

    const eventSource = new EventSource(`/api/topics/${topicId}/events`);

    eventSource.addEventListener('connected', () => {
      setIsLive(true);
    });

    eventSource.addEventListener('node_added', (e: MessageEvent) => {
      try {
        const newNode: ClaimNode = JSON.parse(e.data);
        setTopic((prev) => {
          if (!prev) return null;
          if (prev.nodes.some((n) => n.id === newNode.id)) return prev;
          return { ...prev, nodes: [...prev.nodes, newNode] };
        });
        showToast(`⚡ Live: New claim added to graph.`, 'info');
      } catch (err) {
        console.error('Failed to parse SSE node_added payload', err);
      }
    });

    eventSource.addEventListener('node_voted', (e: MessageEvent) => {
      try {
        const updatedNode: ClaimNode = JSON.parse(e.data);
        setTopic((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            nodes: prev.nodes.map((n) => (n.id === updatedNode.id ? { ...n, ...updatedNode, userVote: n.userVote } : n)),
          };
        });
      } catch (err) {
        console.error('Failed to parse SSE node_voted payload', err);
      }
    });

    eventSource.addEventListener('root_updated', (e: MessageEvent) => {
      try {
        const updatedRoot: ClaimNode = JSON.parse(e.data);
        setTopic((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            title: updatedRoot.content,
            nodes: prev.nodes.map((n) => (n.id === updatedRoot.id ? updatedRoot : n)),
          };
        });
        showToast(`⚡ Live: Topic root claim updated.`, 'info');
      } catch (err) {
        console.error('Failed to parse SSE root_updated payload', err);
      }
    });

    eventSource.onerror = () => {
      setIsLive(false);
    };

    return () => {
      setIsLive(false);
      eventSource.close();
    };
  }, [topicId]);

  const showToast = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3200);
  };

  const handleShareLink = () => {
    const deepLinkUrl = window.location.href;
    navigator.clipboard.writeText(deepLinkUrl).then(() => {
      showToast('🔗 Deep link URL copied to clipboard!', 'success');
    }).catch(() => {
      showToast(`Deep link: ${deepLinkUrl}`, 'info');
    });
  };

  const handleVote = async (nodeId: string, voteType: 'support' | 'contest') => {
    if (!topic || !currentUser) return;

    const previousTopic = topic;

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
          showToast(`Vote recorded as ${updatedNode.userVote.toUpperCase()}.`, 'success');
        } else {
          showToast('Vote removed.', 'info');
        }
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Vote update failed.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to submit vote to backend', err);
      setTopic(previousTopic);
      showToast('Network error: Vote could not be saved to server.', 'error');
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
        handleSelectNode(newNode.id);
        showToast('Claim added to the argument graph.', 'success');
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Failed to add claim.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to create node on backend', err);
      showToast('Network error: Could not submit claim to server.', 'error');
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
        showToast('Forked — redirecting to your new debate workspace…', 'success');
        setTimeout(() => navigate(`/t/${forkedTopic.id}`), 1000);
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Failed to fork topic.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to fork topic', err);
      showToast('Network error: Could not fork topic graph.', 'error');
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

  if (notFound) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--marble)', color: 'var(--ink)' }}>
        <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '22px', marginBottom: '12px' }}>DEBATE NOT FOUND</h2>
        <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '16px', color: 'var(--ink-soft)', marginBottom: '20px' }}>
          This argument graph does not exist or has been archived.
        </p>
        <button className="fork-btn" onClick={() => navigate('/')}>
          ← Back to All Debates
        </button>
      </div>
    );
  }

  const selectedNode = topic?.nodes.find((n) => n.id === selectedId) || null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Bar */}
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
        isLive={isLive}
        onSelectViewMode={handleSelectViewMode}
        onFork={handleFork}
        onSwitchUser={onSwitchUser}
      />

      <div className="app">
        {/* Network Error Screen */}
        {errorMsg && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div
              style={{
                background: '#FDF2F0',
                border: '1px solid var(--oxide)',
                borderRadius: '8px',
                padding: '28px',
                maxWidth: '520px',
                textAlign: 'center',
                boxShadow: 'var(--shadow)'
              }}
            >
              <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '16px', color: 'var(--oxide)', margin: '0 0 10px' }}>
                SERVER CONNECTION FAILED
              </h3>
              <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '16px', color: 'var(--ink)', margin: '0 0 20px', lineHeight: 1.45 }}>
                {errorMsg}
              </p>
              <button
                onClick={() => topicId && fetchTopic(topicId)}
                className="fork-btn"
                style={{ background: 'var(--oxide)', margin: '0 auto' }}
              >
                ↻ Retry Loading Graph
              </button>
            </div>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoading && !errorMsg && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '14px', background: 'var(--marble)' }}>
            <div style={{ fontFamily: 'Cinzel, serif', fontSize: '13px', letterSpacing: '0.12em', color: 'var(--gold)' }}>
              FETCHING ARGUMENT GRAPH…
            </div>
            <div style={{ width: '40px', height: '40px', border: '3px solid var(--marble-line)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          </div>
        )}

        {/* Graph Canvas */}
        {!isLoading && !errorMsg && viewMode === 'diff' ? (
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
          !isLoading && !errorMsg && topic && (
            <GraphCanvas
              nodes={topic.nodes}
              selectedId={selectedId}
              viewMode={viewMode}
              onSelectNode={handleSelectNode}
              onUpdateNodePosition={handleUpdateNodePosition}
            />
          )
        )}

        {!isLoading && !errorMsg && viewMode !== 'diff' && <Legend />}

        {!isLoading && !errorMsg && (
          <SidePanel
            selectedNode={selectedNode}
            currentUser={currentUser}
            onVote={handleVote}
            onAddClaim={handleAddClaim}
            onShareLink={handleShareLink}
          />
        )}
      </div>

      <Toast toast={toast} />
    </div>
  );
};
