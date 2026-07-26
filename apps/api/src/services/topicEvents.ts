import { EventEmitter } from 'events';

class TopicEventEmitter extends EventEmitter {}

export const topicEvents = new TopicEventEmitter();
topicEvents.setMaxListeners(100);

export interface TopicMutationEvent {
  type: 'node_added' | 'node_voted' | 'root_updated';
  topicId: string;
  payload: unknown;
  timestamp: string;
}

export function emitTopicMutation(
  topicId: string,
  type: TopicMutationEvent['type'],
  payload: unknown
): void {
  const event: TopicMutationEvent = {
    type,
    topicId,
    payload,
    timestamp: new Date().toISOString(),
  };
  topicEvents.emit(`topic:${topicId}`, event);
}
