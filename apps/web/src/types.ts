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

export type ViewMode = 'graph' | 'steelman' | 'diff';
