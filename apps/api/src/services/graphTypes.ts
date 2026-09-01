export interface ClaimNode {
  id: string;
  parent: string | null;
  edgeType: 'root' | 'supports' | 'refutes' | 'clarifies' | 'evidence';
  x: number;
  y: number;
  content: string;
  support: number;
  contest: number;
  steel: boolean;
  userVote?: 'support' | 'contest' | null;
  authorId: string;
  authorUsername?: string;
  createdAt: string;
  hasMoreChildren?: boolean;
}

export interface TopicSummary {
  id: string;
  title: string;
  rootNodeId: string;
  forkCount: number;
  forkedFromId?: string | null;
  createdAt: string;
  claimCount: number;
  rootClaimContent: string | null;
}

export interface Topic {
  id: string;
  title: string;
  rootNodeId: string;
  forkCount: number;
  forkedFromId?: string | null;
  createdAt: string;
  nodes: ClaimNode[];
}

export interface NodeVersion {
  id: string;
  nodeId: string;
  content: string;
  version: number;
  editedBy: string;
  createdAt: string;
}

export interface SearchResults {
  topics: TopicSummary[];
  claims: {
    id: string;
    topicId: string;
    topicTitle: string;
    content: string;
    edgeType: string;
    createdAt: string;
  }[];
}

export interface User {
  id: string;
  clerkId?: string;
  username: string;
  email: string;
  reputation: number;
  isActive?: boolean;
  anonymizedAt?: string | null;
}

export type TopicRole = 'owner' | 'contributor' | 'viewer';

export interface TopicMember {
  topicId: string;
  userId: string;
  role: TopicRole;
  createdAt: string;
}

export interface PaginatedTopics {
  topics: TopicSummary[];
  total: number;
  page?: number;
  limit: number;
  totalPages?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface FlagResult {
  nodeId: string;
  status: string;
}
