/**
 * GitHub connector types
 */

export interface PullRequestInfo {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headBranch: string;
  baseBranch: string;
  author: string;
  url: string;
  body: string;
  labels: string[];
}

export interface PrDiffFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface CIStatus {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

export interface GitHubDiscussion {
  number: number;
  title: string;
  body: string;
  category: string;
  author: string;
  url: string;
}
