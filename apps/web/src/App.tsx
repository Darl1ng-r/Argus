import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { TopicPage } from './pages/TopicPage';
import { User } from './types';

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
      <Routes>
        <Route
          path="/"
          element={<HomePage user={currentUser} onSwitchUser={handleSwitchUser} />}
        />
        <Route
          path="/t/:topicId"
          element={<TopicPage currentUser={currentUser} onSwitchUser={handleSwitchUser} />}
        />
        <Route
          path="*"
          element={<HomePage user={currentUser} onSwitchUser={handleSwitchUser} />}
        />
      </Routes>
    </Router>
  );
};
