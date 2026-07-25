import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';

export interface TopicSummary {
  id: string;
  title: string;
  rootNodeId: string;
  forkCount: number;
  createdAt: string;
  claimCount?: number;
  rootClaimContent?: string;
}

interface HomePageProps {
  user: User | null;
  onSwitchUser: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ user, onSwitchUser }) => {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newRootClaim, setNewRootClaim] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    fetchTopics();
  }, []);

  const fetchTopics = async () => {
    try {
      const res = await fetch('/api/topics');
      if (res.ok) {
        const data: TopicSummary[] = await res.json();
        
        // Enrich topic items with root claim previews and claim counts
        const enriched = await Promise.all(
          data.map(async (t) => {
            try {
              const detailRes = await fetch(`/api/topics/${t.id}?depth=1`);
              if (detailRes.ok) {
                const detail = await detailRes.json();
                return {
                  ...t,
                  claimCount: detail.nodes?.length || 1,
                  rootClaimContent: detail.nodes?.find((n: any) => n.edgeType === 'root')?.content || t.title
                };
              }
            } catch {
              // Fallback
            }
            return t;
          })
        );
        setTopics(enriched);
      }
    } catch (err) {
      console.error('Failed to fetch topics', err);
    }
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!newTitle.trim() || !newRootClaim.trim()) {
      setErrorMsg('Both Debate Title and Root Claim are required.');
      return;
    }

    try {
      const userId = localStorage.getItem('argus_user_id') || 'system';
      const userName = localStorage.getItem('argus_user_name') || 'system';

      const res = await fetch('/api/topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          'X-User-Name': userName
        },
        body: JSON.stringify({
          title: newTitle.trim(),
          rootClaim: newRootClaim.trim()
        })
      });

      if (res.ok) {
        const createdTopic = await res.json();
        setIsModalOpen(false);
        setNewTitle('');
        setNewRootClaim('');
        navigate(`/t/${createdTopic.id}`);
      } else {
        const errData = await res.json();
        setErrorMsg(errData.error || 'Failed to create topic.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error while creating topic.');
    }
  };

  const filteredTopics = topics.filter(
    (t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.rootClaimContent && t.rootClaimContent.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--marble)', color: 'var(--ink)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header>
        <div className="brand">
          <h1>ARGUS</h1>
          <span className="tag">Ratio, in the open.</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            className="fork-btn"
            onClick={() => setIsModalOpen(true)}
            style={{ background: 'var(--gold)', color: '#FFFDF8' }}
          >
            ＋ Start a Debate
          </button>

          {user && (
            <button
              onClick={onSwitchUser}
              title="Click to switch test user identity"
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '11px',
                fontWeight: 600,
                background: 'var(--marble-panel)',
                color: 'var(--ink)',
                border: '1px solid var(--marble-line)',
                padding: '6px 12px',
                borderRadius: '20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--laurel)' }}></span>
              @{user.username}
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '36px 24px' }}>
        {/* Banner Section */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '26px', letterSpacing: '0.1em', marginBottom: '10px' }}>
            DEBATES ARE DIRECTED GRAPHS, NOT THREADS
          </h2>
          <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '18px', color: 'var(--ink-soft)', maxWidth: '640px', margin: '0 auto 24px', lineHeight: 1.45 }}>
            Explore open arguments, inspect evidence, vote on claims, and surface the steelman reasoning.
          </p>

          {/* Search Input */}
          <div style={{ maxWidth: '520px', margin: '0 auto', position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search debates or claims…"
              style={{
                width: '100%',
                padding: '12px 18px',
                fontSize: '14.5px',
                fontFamily: 'Inter, sans-serif',
                borderRadius: '24px',
                border: '1px solid var(--marble-line)',
                background: '#FFFDF8',
                boxShadow: 'var(--shadow)',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Topics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '22px' }}>
          {filteredTopics.map((topic) => (
            <div
              key={topic.id}
              onClick={() => navigate(`/t/${topic.id}`)}
              style={{
                background: 'linear-gradient(180deg, #FFFDF8, #F3EEE1)',
                border: '1px solid var(--marble-line)',
                borderRadius: '8px',
                padding: '22px 20px',
                boxShadow: 'var(--shadow)',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--gold)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(43,38,34,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--marble-line)';
                e.currentTarget.style.boxShadow = 'var(--shadow)';
              }}
            >
              <div>
                <div style={{ fontFamily: 'Cinzel, serif', fontSize: '9.5px', letterSpacing: '0.1em', color: 'var(--gold)', marginBottom: '8px', fontWeight: 600 }}>
                  ARGUMENT GRAPH
                </div>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '15px', lineHeight: 1.35, margin: '0 0 12px', color: 'var(--ink)' }}>
                  {topic.title}
                </h3>
                <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14.5px', color: 'var(--ink-soft)', lineHeight: 1.4, margin: '0 0 16px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  "{topic.rootClaimContent || topic.title}"
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--ink-soft)', paddingTop: '12px', borderTop: '1px solid var(--marble-line)' }}>
                <span>{topic.claimCount || 1} claims · {topic.forkCount} forks</span>
                <span style={{ color: 'var(--aegean)', fontWeight: 600 }}>View Graph →</span>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Start New Debate Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(43,38,34,0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setIsModalOpen(false)}
        >
          <div
            style={{
              background: '#FFFDF8',
              border: '1px solid var(--gold)',
              borderRadius: '10px',
              maxWidth: '520px',
              width: '90%',
              padding: '28px',
              boxShadow: '0 16px 40px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '17px', letterSpacing: '0.08em', margin: '0 0 16px', color: 'var(--ink)' }}>
              START A NEW DEBATE
            </h3>

            {errorMsg && (
              <div style={{ background: '#FDF2F0', color: 'var(--oxide)', padding: '10px 14px', borderRadius: '6px', fontSize: '12.5px', marginBottom: '14px', border: '1px solid #F5C6CB' }}>
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateTopic}>
              <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                Debate Question / Title
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Artificial Superintelligence should be paused globally."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '13.5px',
                  fontFamily: 'Inter, sans-serif',
                  borderRadius: '6px',
                  border: '1px solid var(--marble-line)',
                  marginBottom: '16px',
                  background: '#FFFDF8'
                }}
              />

              <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                Root Claim (The core proposition)
              </label>
              <textarea
                value={newRootClaim}
                onChange={(e) => setNewRootClaim(e.target.value)}
                placeholder="State the primary atomic claim plainly…"
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14.5px',
                  fontFamily: 'Crimson Pro, serif',
                  borderRadius: '6px',
                  border: '1px solid var(--marble-line)',
                  marginBottom: '20px',
                  background: '#FFFDF8',
                  resize: 'vertical'
                }}
              />

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '6px',
                    border: '1px solid var(--marble-line)',
                    background: 'transparent',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '12.5px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  style={{
                    padding: '9px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'var(--gold)',
                    color: '#FFFDF8',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    cursor: 'pointer'
                  }}
                >
                  Initialize Debate Graph
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
