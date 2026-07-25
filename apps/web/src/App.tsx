import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { User } from './types';

// Fix #17 — Code splitting: TopicPage (+ Cytoscape.js ~500KB) is loaded lazily
// only when the user navigates to a topic route.
const TopicPage = lazy(() =>
  import('./pages/TopicPage').then((m) => ({ default: m.TopicPage }))
);

function GraphLoadingFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '16px',
        color: 'var(--parchment, #A89070)',
        fontFamily: 'Inter, sans-serif',
        fontSize: '14px',
        background: 'var(--marble, #F8F4ED)',
      }}
    >
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: '3px solid var(--gold, #B8892B)',
          borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      Loading argument graph…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

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

  const fetchUserProfile = async (userId: string, username?: string) => {
    try {
      const res = await fetch('/api/me', {
        headers: {
          'X-User-Id': userId,
          'X-User-Name': username || '',
        },
      });
      if (res.ok) {
        const u: User = await res.json();
        setCurrentUser(u);
      }
    } catch (err) {
      console.error('Failed to fetch user profile', err);
    }
  };

  const handleSwitchUser = () => {
    const names = ['Athena', 'Socrates', 'Hypatia', 'Aristotle', 'Diogenes', 'Cleopatra'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const newId = 'usr_' + randomName.toLowerCase() + '_' + Math.floor(Math.random() * 100);

    localStorage.setItem('argus_user_id', newId);
    localStorage.setItem('argus_user_name', randomName);

    fetchUserProfile(newId, randomName);
  };

  return (
    <Router>
      <Suspense fallback={<GraphLoadingFallback />}>
        <Routes>
          <Route path="/" element={<HomePage user={currentUser} onSwitchUser={handleSwitchUser} />} />
          <Route
            path="/t/:topicId"
            element={<TopicPage currentUser={currentUser} onSwitchUser={handleSwitchUser} />}
          />
          <Route
            path="*"
            element={<HomePage user={currentUser} onSwitchUser={handleSwitchUser} />}
          />
        </Routes>
      </Suspense>
    </Router>
  );
};
