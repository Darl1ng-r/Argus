import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { GraphCanvas } from '../components/GraphCanvas';
import { SidePanel } from '../components/SidePanel';
import { Legend } from '../components/Legend';
import { Toast, ToastState } from '../components/Toast';
import { AIAssistantModal, AIAnalysisResult } from '../components/AIAssistantModal';
import { NodeSearchModal } from '../components/NodeSearchModal';
import { AuthModal } from '../components/AuthModal';
import { useTopicSSE } from '../hooks/useTopicSSE';
import { useGraphExport } from '../hooks/useGraphExport';
import { Topic, ClaimNode, ViewMode, EdgeType, User } from '../types';
import { Core } from 'cytoscape';
import { apiFetch, getAuthHeaders } from '../utils/auth';

interface TopicSummaryOption {
  id: string;
  title: string;
}

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

  // Search & Export & Auth & Cytoscape Core states
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [cyInstance, setCyInstance] = useState<Core | null>(null);

  // AI Assistant States
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Diff View States
  const [otherTopics, setOtherTopics] = useState<TopicSummaryOption[]>([]);
  const [diffCompareId, setDiffCompareId] = useState<string>('');
  const [diffResult, setDiffResult] = useState<{
    addedNodes: ClaimNode[];
    removedNodes: ClaimNode[];
    sharedNodes: ClaimNode[];
  } | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState(false);

  const showToast = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3200);
  }, []);

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

  const fetchTopic = useCallback(async (id: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setNotFound(false);

    try {
      const res = await apiFetch(`/api/topics/${id}`);

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

  useEffect(() => {
    if (topicId) {
      fetchTopic(topicId);
    }
  }, [topicId, fetchTopic]);

  // Real-time Collaboration via custom useTopicSSE Hook
  const { isLive } = useTopicSSE({
    topicId,
    onNodeAdded: useCallback((newNode: ClaimNode) => {
      setTopic((prev) => {
        if (!prev) return null;
        if (prev.nodes.some((n) => n.id === newNode.id)) return prev;
        return { ...prev, nodes: [...prev.nodes, newNode] };
      });
    }, []),
    onNodeVoted: useCallback((updatedNode: ClaimNode) => {
      setTopic((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === updatedNode.id ? { ...n, ...updatedNode, userVote: n.userVote } : n)),
        };
      });
    }, []),
    onNodeUpdated: useCallback((updatedNode: ClaimNode) => {
      setTopic((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === updatedNode.id ? { ...n, ...updatedNode } : n)),
        };
      });
    }, []),
    onNodeDeleted: useCallback((deletedNodeId: string) => {
      setTopic((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== deletedNodeId),
        };
      });
    }, []),
    onRootUpdated: useCallback((updatedRoot: ClaimNode) => {
      setTopic((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          title: updatedRoot.content,
          nodes: prev.nodes.map((n) => (n.id === updatedRoot.id ? updatedRoot : n)),
        };
      });
    }, []),
    onToast: showToast,
  });

  // Canvas Graph Export via custom useGraphExport Hook
  const { handleExport } = useGraphExport({ topic, cyInstance, onToast: showToast });

  const handleShareLink = useCallback(() => {
    const deepLinkUrl = window.location.href;
    navigator.clipboard.writeText(deepLinkUrl).then(() => {
      showToast('Deep link URL copied to clipboard!', 'success');
    }).catch(() => {
      showToast(`Deep link: ${deepLinkUrl}`, 'info');
    });
  }, [showToast]);

  // Keyboard shortcut for Ctrl+F node search modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAIAnalyze = async () => {
    if (!topic) return;
    setIsAIModalOpen(true);
    setAiLoading(true);
    setAiError(null);

    try {
      const res = await apiFetch(`/api/topics/${topic.id}/ai-analyze`, {
        method: 'POST',
      });

      if (res.ok) {
        const data: AIAnalysisResult = await res.json();
        setAiAnalysis(data);
      } else {
        const errData = await res.json();
        setAiError(errData.error || 'Failed to analyze topic graph.');
      }
    } catch (err: any) {
      setAiError(err.message || 'Network error while requesting AI analysis.');
    } finally {
      setAiLoading(false);
    }
  };

  // Fetch list of topics for Diff comparison dropdown when entering Diff view
  useEffect(() => {
    if (viewMode === 'diff' && topicId) {
      apiFetch('/api/topics?limit=50')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.topics) {
            const options = data.topics
              .filter((t: any) => t.id !== topicId)
              .map((t: any) => ({ id: t.id, title: t.title }));
            setOtherTopics(options);
            if (options.length > 0 && !diffCompareId) {
              handleFetchDiff(options[0].id);
            }
          }
        })
        .catch(() => {});
    }
  }, [viewMode, topicId]);

  const handleFetchDiff = async (compareId: string) => {
    if (!topicId || !compareId) return;
    setDiffCompareId(compareId);
    setIsDiffLoading(true);

    try {
      const res = await apiFetch(`/api/topics/${topicId}/diff/${compareId}`);
      if (res.ok) {
        const data = await res.json();
        setDiffResult(data.diff);
      }
    } catch (err) {
      console.error('Failed to fetch graph diff', err);
    } finally {
      setIsDiffLoading(false);
    }
  };

  const handleVote = async (nodeId: string, voteType: 'support' | 'contest') => {
    if (!topic || !currentUser) return;

    const previousTopic = topic;

    try {
      const res = await apiFetch(`/api/topics/${topic.id}/nodes/${nodeId}/vote`, {
        method: 'POST',
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
      const res = await apiFetch(`/api/topics/${topic.id}/nodes`, {
        method: 'POST',
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

  const handleEditClaim = async (nodeId: string, newContent: string) => {
    if (!topic) return;
    try {
      const res = await apiFetch(`/api/topics/${topic.id}/nodes/${nodeId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: newContent }),
      });

      if (res.ok) {
        const updatedNode: ClaimNode = await res.json();
        setTopic((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            nodes: prev.nodes.map((n) => (n.id === nodeId ? updatedNode : n)),
          };
        });
        showToast('Claim content updated.', 'success');
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Failed to edit claim.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to edit claim on backend', err);
      showToast('Network error: Could not save claim edit.', 'error');
    }
  };

  const handleDeleteClaim = async (nodeId: string) => {
    if (!topic) return;
    try {
      const res = await apiFetch(`/api/topics/${topic.id}/nodes/${nodeId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setTopic((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            nodes: prev.nodes.filter((n) => n.id !== nodeId),
          };
        });
        if (selectedId === nodeId) setSelectedId(null);
        showToast('Claim removed from discussion.', 'success');
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Failed to delete claim.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to delete claim on backend', err);
      showToast('Network error: Could not delete claim.', 'error');
    }
  };

  const handleFork = async () => {
    if (!topic) return;
    try {
      const res = await apiFetch(`/api/topics/${topic.id}/fork`, {
        method: 'POST',
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

  const selectedNode = topic?.nodes?.find((n) => n.id === selectedId) || null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
        onAIAnalyze={handleAIAnalyze}
        onOpenSearch={() => setIsSearchOpen(true)}
        onExport={handleExport}
        onSwitchUser={onSwitchUser}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <div className="app">
        {/* Unauthenticated Access Barrier Gate */}
        {!currentUser && !isLoading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', background: 'var(--marble)' }}>
            <div
              style={{
                background: '#FFFDF8',
                border: '1px solid var(--gold)',
                borderRadius: '12px',
                padding: '40px 32px',
                maxWidth: '520px',
                width: '100%',
                textAlign: 'center',
                boxShadow: '0 20px 50px rgba(43,38,34,0.15)'
              }}
            >
              <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '19px', color: 'var(--ink)', margin: '0 0 12px', letterSpacing: '0.08em' }}>
                AUTHENTICATION REQUIRED
              </h3>
              <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '16.5px', color: 'var(--ink-soft)', margin: '0 0 28px', lineHeight: 1.5 }}>
                You must be signed in to view debate graph topologies, inspect claim standing, vote, or post dialectic arguments.
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setIsAuthModalOpen(true)}
                  style={{
                    padding: '12px 24px',
                    background: 'var(--gold)',
                    color: '#FFFDF8',
                    border: 'none',
                    borderRadius: '8px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(184, 137, 43, 0.25)'
                  }}
                >
                  Sign In or Register →
                </button>
                <button
                  onClick={() => navigate('/')}
                  style={{
                    padding: '12px 20px',
                    background: 'transparent',
                    color: 'var(--aegean)',
                    border: '1px solid var(--marble-line)',
                    borderRadius: '8px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ← Back to Discover
                </button>
              </div>
            </div>
          </div>
        )}

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
                Retry Loading Graph
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

        {/* Functional Graph Diff Engine View */}
        {currentUser && !isLoading && !errorMsg && viewMode === 'diff' ? (
          <div className="canvas-area" style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Diff Controls Header */}
            <div style={{ padding: '12px 24px', background: 'var(--marble-panel)', borderBottom: '1px solid var(--marble-line)', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontFamily: 'Cinzel, serif', fontSize: '12px', letterSpacing: '0.08em', color: 'var(--gold)', fontWeight: 700 }}>
                COMPARE FORKS:
              </span>
              {otherTopics.length > 0 ? (
                <select
                  value={diffCompareId}
                  onChange={(e) => handleFetchDiff(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--marble-line)',
                    background: '#FFFDF8',
                  }}
                >
                  {otherTopics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: '13px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft)' }}>
                  No other debate forks found to compare. Create or fork another debate!
                </span>
              )}
            </div>

            {/* Diff Summary Overlays */}
            {diffResult && (
              <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div style={{ flex: 1, padding: '16px', background: '#F0F4E8', border: '1px solid #C4D4A4', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px', color: '#6E7B4A', fontFamily: 'Cinzel, serif', fontSize: '13px' }}>
                      CLAIMS ADDED IN THIS FORK ({diffResult.addedNodes.length})
                    </h4>
                    {diffResult.addedNodes.map((n) => (
                      <div key={n.id} style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14.5px', color: 'var(--ink)', marginBottom: '6px' }}>
                        • "{n.content}" <span style={{ fontSize: '11px', color: '#6E7B4A' }}>({n.edgeType})</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ flex: 1, padding: '16px', background: '#FDF2F0', border: '1px solid #F2D5CE', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px', color: '#A2472E', fontFamily: 'Cinzel, serif', fontSize: '13px' }}>
                      CLAIMS REMOVED / MISSING ({diffResult.removedNodes.length})
                    </h4>
                    {diffResult.removedNodes.map((n) => (
                      <div key={n.id} style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14.5px', color: 'var(--ink)', marginBottom: '6px' }}>
                        • "{n.content}" <span style={{ fontSize: '11px', color: '#A2472E' }}>({n.edgeType})</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ flex: 1, padding: '16px', background: '#FFFDF8', border: '1px solid var(--marble-line)', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px', color: 'var(--gold)', fontFamily: 'Cinzel, serif', fontSize: '13px' }}>
                      SHARED CLAIMS ({diffResult.sharedNodes.length})
                    </h4>
                    {diffResult.sharedNodes.map((n) => (
                      <div key={n.id} style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14.5px', color: 'var(--ink)', marginBottom: '6px' }}>
                        • "{n.content}"
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          currentUser && !isLoading && !errorMsg && topic && (
            <GraphCanvas
              nodes={topic.nodes}
              selectedId={selectedId}
              viewMode={viewMode}
              onSelectNode={handleSelectNode}
              onUpdateNodePosition={handleUpdateNodePosition}
              onCyReady={(cy) => setCyInstance(cy)}
            />
          )
        )}

        {currentUser && !isLoading && !errorMsg && viewMode !== 'diff' && <Legend />}

        {currentUser && !isLoading && !errorMsg && (
          <SidePanel
            selectedNode={selectedNode}
            currentUser={currentUser}
            onVote={handleVote}
            onAddClaim={handleAddClaim}
            onEditClaim={handleEditClaim}
            onDeleteClaim={handleDeleteClaim}
            onShareLink={handleShareLink}
          />
        )}
      </div>

      {/* Gemini AI Assistant Analysis Modal */}
      <AIAssistantModal
        isOpen={isAIModalOpen}
        topicTitle={topic?.title || ''}
        analysis={aiAnalysis}
        loading={aiLoading}
        error={aiError}
        onClose={() => setIsAIModalOpen(false)}
        onSelectNode={handleSelectNode}
      />

      {/* Ctrl+F Node Search Modal */}
      <NodeSearchModal
        isOpen={isSearchOpen}
        nodes={topic?.nodes || []}
        onClose={() => setIsSearchOpen(false)}
        onSelectNode={handleSelectNode}
      />

      {/* Auth & Profile Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        user={currentUser}
        onClose={() => setIsAuthModalOpen(false)}
        onUserChanged={onSwitchUser}
      />

      <Toast toast={toast} />
    </div>
  );
};
