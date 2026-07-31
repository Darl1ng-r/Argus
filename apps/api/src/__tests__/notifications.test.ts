import { describe, it, expect } from 'vitest';
import {
  getUserNotifications,
  markNotificationsAsRead,
  createNotification,
} from '../services/notificationService.js';

describe('Item 20: Notification System', () => {
  it('prevents sending notification to self', async () => {
    const res = await createNotification(
      'user-123',
      'user-123', // Same user
      'NODE_REPLIED',
      'topic-456',
      'node-789',
      'Self reply'
    );

    expect(res).toBeNull();
  });

  it('exports notification service functions', () => {
    expect(typeof getUserNotifications).toBe('function');
    expect(typeof markNotificationsAsRead).toBe('function');
    expect(typeof createNotification).toBe('function');
  });
});
