import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { GraphCanvas } from './components/GraphCanvas';
import { SidePanel } from './components/SidePanel';
import { Legend } from './components/Legend';
import { Toast } from './components/Toast';
import { Topic, ClaimNode, ViewMode, EdgeType, User } from './types';

export const App: React.FC = () => {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Initialize persistent user identity from localStorage or create new
  useEffect(() => {
    let storedId = localStorage.getItem('argus_user_id');
    let storedName = localStorage.getItem('argus_user_name');

    if (!storedId) {
      storedId = 'usr_' + Math.random().toString(36).substring(2, 9);
      storedName = 'User_' + storedId.slice(4);
      localStorage.setItem('argus_user_id', storedId);
      localStorage.setItem('argus_user_name', storedName);
    }

    fetchUserProfile(storedId, storedName || undefined);
  }, []);

  const getAuthHeaders = useCallback(() => {
    const userId = localStorage.getItem('argus_user_id') || 'system';
    const userName = localStorage.getItem('argus_user_name') || 'system';
    return {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-User-Name': userName
    };
  }, []);

  const fetchUserProfile = async (userId: string, username?: string) => {
    try {
      const res = await fetch('/api/me', {
        headers: {
          'X-User-Id': userId,
          'X-User-Name': username || ''
        }
      });
      if (res.ok) {
        const u: User = await res.json();
        setCurrentUser(u);
      }
    } catch (err) {
      console.error('Failed to fetch user profile', err);
    }
  };

  // Fetch topic with user-specific vote states attached
  const fetchTopic = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/topics/${id}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setTopic(data);
      }
    } catch (err) {
      console.error('Failed to fetch topic from API', err);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (currentUser) {
      fetchTopic('mars-vs-earth');
    }
  }, [currentUser, fetchTopic]);

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
        setTopic(forkedTopic);
        showToast('Forked — this graph now lives in your workspace.');
      }
    } catch (err) {
      console.error('Failed to fork topic', err);
    }
  };

  const handleSwitchUser = () => {
    const names = ['Athena', 'Socrates', 'Hypatia', 'Aristotle', 'Diogenes', 'Cleopatra'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const newId = 'usr_' + randomName.toLowerCase() + '_' + Math.floor(Math.random() * 100);

    localStorage.setItem('argus_user_id', newId);
    localStorage.setItem('argus_user_name', randomName);

    fetchUserProfile(newId, randomName);
    showToast(`Switched user profile to @${randomName}`);
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
        user={currentUser}
        onSelectViewMode={setViewMode}
        onFork={handleFork}
        onSwitchUser={handleSwitchUser}
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
