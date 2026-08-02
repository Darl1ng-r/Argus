export type EdgeType = 'root' | 'supports' | 'refutes' | 'clarifies' | 'evidence';

export interface ClaimNode {
  id: string;
  parent: string | null;
  edgeType: EdgeType;
  x: number;
  y: number;
  content: string;
  support: number;
  contest: number;
  steel: boolean;
  userVote?: 'support' | 'contest' | null;
  authorId?: string;
  authorUsername?: string; // Fix F-8: included in API responses to avoid client-side N+1 user lookups
  createdAt: string;
}


export interface Topic {
  id: string;
  title: string;
  rootNodeId: string;
  forkCount: number;
  createdAt: string;
  nodes: ClaimNode[];
}

export interface User {
  id: string;
  username: string;
  email: string;
  reputation: number;
}

export type ViewMode = 'graph' | 'steelman' | 'diff';
