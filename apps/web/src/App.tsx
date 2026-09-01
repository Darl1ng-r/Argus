import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { User } from './types';
import { getAuthToken, apiFetch } from './utils/auth';
import { I18nProvider } from './i18n';
import { OfflineIndicator } from './components/OfflineIndicator';

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
  const [authLoading, setAuthLoading] = useState(() => Boolean(getAuthToken()));

  const fetchUserProfile = useCallback(async () => {
    if (!getAuthToken()) {
      setCurrentUser(null);
      setAuthLoading(false);
      return;
    }
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const u: User = await res.json();
        setCurrentUser(u);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserProfile();

    const handleAuthExpired = () => {
      setCurrentUser(null);
    };

    window.addEventListener('argus_auth_expired', handleAuthExpired);
    return () => {
      window.removeEventListener('argus_auth_expired', handleAuthExpired);
    };
  }, [fetchUserProfile]);

  // Callback passed to pages/modals — refreshes user state after auth changes
  const handleUserChanged = useCallback(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

  if (authLoading) {
    return <GraphLoadingFallback />;
  }

  return (
    <I18nProvider>
      <OfflineIndicator />
      <Router>
        <Suspense fallback={<GraphLoadingFallback />}>
          <Routes>
            <Route path="/" element={<HomePage user={currentUser} onUserChanged={handleUserChanged} />} />
            <Route path="/login" element={<LoginPage onLoginSuccess={handleUserChanged} />} />
            <Route path="/register" element={<RegisterPage onRegisterSuccess={handleUserChanged} />} />
            <Route path="/forgot-password" element={<ResetPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/t/:topicId"
              element={
                currentUser
                  ? <TopicPage currentUser={currentUser} onSwitchUser={handleUserChanged} />
                  : <Navigate to="/" replace state={{ requireAuth: true }} />
              }
            />
            <Route
              path="*"
              element={<HomePage user={currentUser} onUserChanged={handleUserChanged} />}
            />
          </Routes>
        </Suspense>
      </Router>
    </I18nProvider>
  );
};
