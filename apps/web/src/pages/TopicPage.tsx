import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { GraphCanvas } from '../components/GraphCanvas';
import { SidePanel } from '../components/SidePanel';
import { Legend } from '../components/Legend';
import { Toast, ToastState } from '../components/Toast';
import { AIAssistantModal, AIAnalysisResult } from '../components/AIAssistantModal';
import { NodeSearchModal } from '../components/NodeSearchModal';
import { exportGraphAsPNG, exportGraphAsSVG, exportGraphAsMarkdown } from '../utils/exportUtils';
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

  // Search & Export & Cytoscape Core states
  const [isSearchOpen, setIsSearchOpen] = useState(false);
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

  const handleExport = (format: 'png' | 'svg' | 'markdown') => {
    if (!topic) return;

    if (format === 'markdown') {
      exportGraphAsMarkdown(topic);
      showToast('📝 Markdown outline exported successfully.', 'success');
      return;
    }

    if (!cyInstance) {
      showToast('Canvas graph engine is initializing, please try again.', 'error');
      return;
    }

    if (format === 'png') {
      exportGraphAsPNG(cyInstance, topic.title);
      showToast('🖼️ High-resolution PNG graph image exported.', 'success');
    } else if (format === 'svg') {
      exportGraphAsSVG(cyInstance, topic.title);
      showToast('📐 Vector graph image exported.', 'success');
    }
  };

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
        onAIAnalyze={handleAIAnalyze}
        onOpenSearch={() => setIsSearchOpen(true)}
        onExport={handleExport}
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

        {/* Functional Graph Diff Engine View */}
        {!isLoading && !errorMsg && viewMode === 'diff' ? (
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
                      🟢 CLAIMS ADDED IN THIS FORK ({diffResult.addedNodes.length})
                    </h4>
                    {diffResult.addedNodes.map((n) => (
                      <div key={n.id} style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14.5px', color: 'var(--ink)', marginBottom: '6px' }}>
                        • "{n.content}" <span style={{ fontSize: '11px', color: '#6E7B4A' }}>({n.edgeType})</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ flex: 1, padding: '16px', background: '#FDF2F0', border: '1px solid #F2D5CE', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px', color: '#A2472E', fontFamily: 'Cinzel, serif', fontSize: '13px' }}>
                      🔴 CLAIMS REMOVED / MISSING ({diffResult.removedNodes.length})
                    </h4>
                    {diffResult.removedNodes.map((n) => (
                      <div key={n.id} style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14.5px', color: 'var(--ink)', marginBottom: '6px' }}>
                        • "{n.content}" <span style={{ fontSize: '11px', color: '#A2472E' }}>({n.edgeType})</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ flex: 1, padding: '16px', background: '#FFFDF8', border: '1px solid var(--marble-line)', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px', color: 'var(--gold)', fontFamily: 'Cinzel, serif', fontSize: '13px' }}>
                      🟡 SHARED CLAIMS ({diffResult.sharedNodes.length})
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
          !isLoading && !errorMsg && topic && (
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

      <Toast toast={toast} />
    </div>
  );
};
