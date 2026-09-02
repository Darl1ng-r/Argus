import { getTopic } from './topicService.js';
import { ClaimNode } from './graphTypes.js';
import { ValidationError } from '../utils/sanitizer.js';

export interface GraphDiffResult {
  baseTopicId: string;
  compareTopicId: string;
  hasDirectLineage: boolean;
  diff: {
    addedNodes: ClaimNode[];
    removedNodes: ClaimNode[];
    sharedNodes: ClaimNode[];
  };
}

export async function compareTopicForks(
  baseTopicId: string,
  compareTopicId: string,
  currentUserId?: string
): Promise<GraphDiffResult> {
  const [baseTopic, compareTopic] = await Promise.all([
    getTopic(baseTopicId, currentUserId),
    getTopic(compareTopicId, currentUserId),
  ]);

  if (!baseTopic) throw new ValidationError(`Base topic not found: ${baseTopicId}`);
  if (!compareTopic) throw new ValidationError(`Comparison topic not found: ${compareTopicId}`);

  const hasDirectLineage = Boolean(
    baseTopic.forkedFromId === compareTopic.id ||
    compareTopic.forkedFromId === baseTopic.id ||
    (baseTopic.forkedFromId && baseTopic.forkedFromId === compareTopic.forkedFromId) ||
    baseTopic.id === compareTopic.id
  );

  const compareContentMap = new Map<string, ClaimNode>();
  for (const node of compareTopic.nodes) {
    compareContentMap.set(node.content.trim().toLowerCase(), node);
  }

  const baseContentMap = new Map<string, ClaimNode>();
  for (const node of baseTopic.nodes) {
    baseContentMap.set(node.content.trim().toLowerCase(), node);
  }

  const addedNodes: ClaimNode[] = [];
  const sharedNodes: ClaimNode[] = [];
  const removedNodes: ClaimNode[] = [];

  for (const node of compareTopic.nodes) {
    const key = node.content.trim().toLowerCase();
    if (baseContentMap.has(key)) {
      sharedNodes.push(node);
    } else {
      addedNodes.push(node);
    }
  }

  for (const node of baseTopic.nodes) {
    const key = node.content.trim().toLowerCase();
    if (!compareContentMap.has(key)) {
      removedNodes.push(node);
    }
  }

  return {
    baseTopicId,
    compareTopicId,
    hasDirectLineage,
    diff: {
      addedNodes,
      removedNodes,
      sharedNodes,
    },
  };
}
