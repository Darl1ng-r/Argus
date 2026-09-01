/**
 * Offline-Resilient Claim & Topic Draft Manager for Argus Agora.
 *
 * Persists in-progress claim texts to localStorage, protecting users from:
 *  - Network partitions / dropouts
 *  - Accidental browser refresh or tab closing
 *  - Device crash recovery
 */

import { useState, useEffect, useCallback } from 'react';

function makeDraftKey(topicId: string, parentId?: string | null): string {
  return `argus_draft:${topicId}:${parentId || 'root'}`;
}

export function getSavedDraft(topicId: string, parentId?: string | null): string {
  try {
    return localStorage.getItem(makeDraftKey(topicId, parentId)) || '';
  } catch {
    return '';
  }
}

export function saveDraftToStorage(topicId: string, content: string, parentId?: string | null): void {
  try {
    const key = makeDraftKey(topicId, parentId);
    if (content.trim()) {
      localStorage.setItem(key, content);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota errors in incognito
  }
}

export function clearSavedDraft(topicId: string, parentId?: string | null): void {
  try {
    localStorage.removeItem(makeDraftKey(topicId, parentId));
  } catch {
    // Ignore
  }
}

/**
 * React hook to bind state with automatic debounced draft persistence.
 */
export function useClaimDraft(topicId: string, parentId?: string | null) {
  const [draft, setDraft] = useState<string>(() => getSavedDraft(topicId, parentId));

  useEffect(() => {
    setDraft(getSavedDraft(topicId, parentId));
  }, [topicId, parentId]);

  const updateDraft = useCallback(
    (newText: string) => {
      setDraft(newText);
      saveDraftToStorage(topicId, newText, parentId);
    },
    [topicId, parentId]
  );

  const clearDraft = useCallback(() => {
    setDraft('');
    clearSavedDraft(topicId, parentId);
  }, [topicId, parentId]);

  return { draft, updateDraft, clearDraft };
}
