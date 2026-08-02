import { useState, useEffect } from 'react';
import { ClaimNode } from '../types';

interface UseTopicSSEOptions {
  topicId?: string;
  onNodeAdded?: (newNode: ClaimNode) => void;
  onNodeVoted?: (updatedNode: ClaimNode) => void;
  onNodeUpdated?: (updatedNode: ClaimNode) => void;
  onNodeDeleted?: (nodeId: string) => void;
  onRootUpdated?: (updatedRoot: ClaimNode) => void;
  onToast?: (message: string, type?: 'info' | 'error' | 'success') => void;
}

export function useTopicSSE({
  topicId,
  onNodeAdded,
  onNodeVoted,
  onNodeUpdated,
  onNodeDeleted,
  onRootUpdated,
  onToast,
}: UseTopicSSEOptions) {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!topicId) return;

    const eventSource = new EventSource(`/api/topics/${topicId}/events`);

    eventSource.addEventListener('connected', () => {
      setIsLive(true);
    });

    eventSource.addEventListener('node_added', (e: MessageEvent) => {
      try {
        const newNode: ClaimNode = JSON.parse(e.data);
        onNodeAdded?.(newNode);
        onToast?.('⚡ Live: New claim added to graph.', 'info');
      } catch (err) {
        console.error('Failed to parse SSE node_added payload', err);
      }
    });

    eventSource.addEventListener('node_voted', (e: MessageEvent) => {
      try {
        const updatedNode: ClaimNode = JSON.parse(e.data);
        onNodeVoted?.(updatedNode);
      } catch (err) {
        console.error('Failed to parse SSE node_voted payload', err);
      }
    });

    eventSource.addEventListener('node_updated', (e: MessageEvent) => {
      try {
        const updatedNode: ClaimNode = JSON.parse(e.data);
        onNodeUpdated?.(updatedNode);
        onToast?.('⚡ Live: A claim was edited.', 'info');
      } catch (err) {
        console.error('Failed to parse SSE node_updated payload', err);
      }
    });

    eventSource.addEventListener('node_deleted', (e: MessageEvent) => {
      try {
        const payload: { nodeId: string } = JSON.parse(e.data);
        onNodeDeleted?.(payload.nodeId);
        onToast?.('⚡ Live: A claim was removed.', 'info');
      } catch (err) {
        console.error('Failed to parse SSE node_deleted payload', err);
      }
    });

    eventSource.addEventListener('root_updated', (e: MessageEvent) => {
      try {
        const updatedRoot: ClaimNode = JSON.parse(e.data);
        onRootUpdated?.(updatedRoot);
        onToast?.('⚡ Live: Topic root claim updated.', 'info');
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
  }, [topicId, onNodeAdded, onNodeVoted, onNodeUpdated, onNodeDeleted, onRootUpdated, onToast]);

  return { isLive };
}
