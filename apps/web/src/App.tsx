import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { User } from './types';
import { getDevUserCredentials, switchDevUser, apiFetch } from './utils/auth';

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
    const creds = getDevUserCredentials();
    fetchUserProfile();
  }, []);

  const fetchUserProfile = async () => {
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const u: User = await res.json();
        setCurrentUser(u);
      }
    } catch (err) {
      console.error('Failed to fetch user profile', err);
    }
  };

  const handleSwitchUser = () => {
    switchDevUser();
    fetchUserProfile();
  };

  return (
    <Router>
      <Suspense fallback={<GraphLoadingFallback />}>
        <Routes>
          <Route path="/" element={<HomePage user={currentUser} onSwitchUser={handleSwitchUser} />} />
          <Route path="/register" element={<RegisterPage onRegisterSuccess={() => fetchUserProfile()} />} />
          <Route path="/forgot-password" element={<ResetPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
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
