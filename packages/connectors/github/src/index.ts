/**
 * @agentmesa/connector-github
 * GitHub PR linking, diff import, review artifact export, CI result import, and discussion import
 */

// Types
export type {
  PullRequestInfo,
  PrDiffFile,
  CIStatus,
  GitHubDiscussion,
} from './types.js';

// PR operations
export {
  listPullRequests,
  getPullRequest,
  getPrDiff,
  getPrDiffFiles,
  createPullRequest,
  linkPrToTask,
} from './pr.js';

// CI operations
export {
  getCIStatus,
  importCIResults,
} from './ci.js';

// Artifact helpers
export {
  createPrDiffArtifact,
  createPrSummaryArtifact,
  createCIResultArtifact,
} from './artifacts.js';
