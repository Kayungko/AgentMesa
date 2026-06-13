import type {
  MesaAgent,
  MesaAgentCapability,
  MesaTask,
  MesaMessage,
  MesaArtifact,
  MesaMeeting,
  MesaThread,
  MesaDecision,
  MesaEvent,
  MesaClient,
  MesaTransport,
  MesaAgentRun,
  MesaCheckResult,
  MesaRepository,
} from './types.js';

// ---------------------------------------------------------------------------
// Identifiers (shared across fixtures so they cross-reference correctly)
// ---------------------------------------------------------------------------

const meetingId = 'meeting_a1b2c3d4';
const taskId = 'task_e5f6a7b8';
const builderId = 'agent_builder_01';
const reviewerId = 'agent_reviewer_01';

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const fixtureBuilderAgent: MesaAgent = {
  id: builderId,
  name: 'Claude Code',
  client: 'claude-code',
  clientId: 'client_c1c2c3c4',
  roles: ['builder', 'planner', 'documenter'],
  status: 'available',
  metadata: { provider: 'anthropic', model: 'claude-opus' },
};

export const fixtureReviewerAgent: MesaAgent = {
  id: reviewerId,
  name: 'Codex',
  client: 'codex',
  clientId: 'client_d1d2d3d4',
  roles: ['reviewer', 'tester'],
  status: 'available',
  metadata: { provider: 'openai', model: 'gpt-5' },
};

// ---------------------------------------------------------------------------
// Agent Capability
// ---------------------------------------------------------------------------

export const fixtureBuilderCapability: MesaAgentCapability = {
  agentId: builderId,
  permissions: ['builder', 'maintainer'],
  supportedTransports: ['file', 'mcp'],
  supportedArtifactKinds: ['implementation_summary', 'git_diff', 'agent_run_log'],
  canReviewCode: false,
  canEditFiles: true,
  canRunShell: true,
  canUseMcp: true,
  canOpenPullRequest: true,
  canReadPullRequest: true,
  canExecuteCommands: ['build', 'test', 'lint'],
  maxContextTokens: 500_000,
  allowedFilePatterns: ['src/**', 'packages/**'],
  deniedFilePatterns: ['.env', '.secret/**'],
};

export const fixtureReviewerCapability: MesaAgentCapability = {
  agentId: reviewerId,
  permissions: ['reviewer'],
  supportedTransports: ['file'],
  supportedArtifactKinds: ['review_report', 'test_result'],
  canReviewCode: true,
  canEditFiles: false,
  canRunShell: false,
  canUseMcp: false,
  canOpenPullRequest: false,
  canReadPullRequest: true,
  canExecuteCommands: [],
  allowedFilePatterns: [],
  deniedFilePatterns: ['.env', '.secret/**'],
};

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export const fixtureTask: MesaTask = {
  protocolVersion: '0.2.0',
  id: taskId,
  title: 'Implement QR login',
  description: 'Add QR code based login flow with redirect and scanner component.',
  status: 'ready_for_review',
  createdBy: 'user',
  assignedTo: builderId,
  assignedBuilder: builderId,
  reviewer: reviewerId,
  assignedReviewer: reviewerId,
  meetingId,
  branch: 'feature/qr-login',
  priority: 'high',
  kind: 'implement',
  context: {
    goal: 'Add QR code based login flow with redirect',
    changedFiles: ['src/auth/qr-login.ts', 'src/auth/qr-scanner.tsx'],
    commands: ['npm test', 'npm run lint'],
  },
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-01T14:30:00Z',
};

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const fixtureMessage: MesaMessage = {
  protocolVersion: '0.2.0',
  id: 'msg_f1e2d3c4',
  meetingId,
  taskId,
  threadId: 'thread_t1t2t3t4',
  from: builderId,
  senderAgentId: builderId,
  to: reviewerId,
  type: 'review_request',
  summary: 'QR login implementation complete. Ready for review.',
  body: 'I have implemented the QR code login flow. Please review the scanner component and auth handler.',
  artifactIds: ['A-0001'],
  createdAt: '2026-06-01T14:30:00Z',
};

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const fixtureReviewArtifact: MesaArtifact = {
  protocolVersion: '0.2.0',
  id: 'A-0001',
  meetingId,
  kind: 'implementation_summary',
  title: 'QR Login Implementation Summary',
  taskId,
  createdBy: builderId,
  producedByAgentId: builderId,
  content: '# Implementation Summary: QR Login\n\nImplemented QR code login flow with scanner component and auth handler.',
  mimeType: 'text/markdown',
  format: 'markdown',
  version: 1,
  tags: ['qr-login', 'auth'],
  createdAt: '2026-06-01T14:25:00Z',
};

export const fixtureReviewReport: MesaArtifact = {
  protocolVersion: '0.2.0',
  id: 'A-0002',
  meetingId,
  kind: 'review_report',
  title: 'QR Login Review Report',
  taskId,
  createdBy: reviewerId,
  producedByAgentId: reviewerId,
  content: '# Review Report: QR Login\n\n## Result: Changes Requested\n\n- Missing input validation on QR payload\n- No rate limiting on scan attempts',
  mimeType: 'text/markdown',
  format: 'markdown',
  version: 1,
  tags: ['qr-login', 'review'],
  metadata: { verdict: 'changes_requested', issuesFound: 2 },
  createdAt: '2026-06-01T16:00:00Z',
};

// ---------------------------------------------------------------------------
// Meeting
// ---------------------------------------------------------------------------

export const fixtureMeeting: MesaMeeting = {
  protocolVersion: '0.2.0',
  id: meetingId,
  title: 'QR Login Feature',
  purpose: 'Implement and review QR code login for the authentication system.',
  status: 'active',
  workspaceId: 'ws_w1w2w3w4',
  ownerAgentId: builderId,
  tasks: [taskId],
  agents: [builderId, reviewerId],
  createdAt: '2026-06-01T09:00:00Z',
  updatedAt: '2026-06-01T14:30:00Z',
};

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export const fixtureThread: MesaThread = {
  protocolVersion: '0.2.0',
  id: 'thread_t1t2t3t4',
  meetingId,
  title: 'QR Security Review Discussion',
  rootMessageId: 'msg_f1e2d3c4',
  resolution: 'unresolved',
  createdAt: '2026-06-01T14:35:00Z',
};

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export const fixtureDecision: MesaDecision = {
  protocolVersion: '0.2.0',
  id: 'decision_d1d2d3d4',
  meetingId,
  taskId,
  threadId: 'thread_t1t2t3t4',
  decidedBy: 'user',
  title: 'Input validation approach for QR payloads',
  options: [
    'Zod schema validation on client side',
    'Server-side validation only',
    'Both client and server validation',
  ],
  selectedOption: 'Both client and server validation',
  rationale: 'Defense in depth prevents invalid payloads from reaching server and provides immediate client feedback.',
  createdAt: '2026-06-01T17:00:00Z',
};

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export const fixtureEvent: MesaEvent = {
  protocolVersion: '0.2.0',
  id: 'event_e1e2e3e4',
  meetingId,
  type: 'task_created',
  streamId: taskId,
  streamType: 'MesaTask',
  data: { title: 'Implement QR login', status: 'todo' },
  actor: 'user',
  sequence: 1,
  timestamp: '2026-06-01T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const fixtureClient: MesaClient = {
  id: 'client_c1c2c3c4',
  name: 'Claude Code',
  type: 'claude-code',
  supportedTransports: ['file', 'mcp', 'http'],
  version: '2026.01.0',
  supportedFeatures: ['mcp', 'file-watch', 'terminal'],
  metadata: { provider: 'anthropic' },
};

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export const fixtureTransportFile: MesaTransport = {
  name: 'File Transport',
  type: 'file',
  capabilities: {
    canCreateTasks: true,
    canReadTasks: true,
    canUpdateTaskStatus: true,
    canPostMessages: true,
    canAttachArtifacts: true,
    canCreateMeetings: true,
    canRegisterAgents: true,
    supportsPush: false,
    supportsBidirectional: false,
  },
  version: '0.2.0',
};

export const fixtureTransportMcp: MesaTransport = {
  name: 'MCP Transport',
  type: 'mcp',
  capabilities: {
    canCreateTasks: true,
    canReadTasks: true,
    canUpdateTaskStatus: true,
    canPostMessages: true,
    canAttachArtifacts: true,
    canCreateMeetings: true,
    canRegisterAgents: true,
    supportsPush: false,
    supportsBidirectional: false,
  },
  version: '2024-11-05',
};

// ---------------------------------------------------------------------------
// Agent Run
// ---------------------------------------------------------------------------

export const fixtureAgentRun: MesaAgentRun = {
  protocolVersion: '0.2.0',
  id: 'run_r1r2r3r4',
  taskId,
  meetingId,
  agentId: builderId,
  runnerType: 'implement',
  action: 'implement',
  status: 'completed',
  input: 'Implement QR code login flow with scanner and auth handler',
  inputSummary: 'Implement QR login',
  output: '# Implementation complete\n\nCreated src/auth/qr-login.ts and src/auth/qr-scanner.tsx',
  outputSummary: 'QR login implemented',
  producedArtifactIds: ['A-0001'],
  startedAt: '2026-06-01T10:05:00Z',
  completedAt: '2026-06-01T14:20:00Z',
  duration: 15300000,
};

// ---------------------------------------------------------------------------
// Check Result
// ---------------------------------------------------------------------------

export const fixtureCheckResult: MesaCheckResult = {
  protocolVersion: '0.2.0',
  id: 'check_c1c2c3c4',
  taskId,
  runId: 'run_r1r2r3r4',
  kind: 'test',
  status: 'passed',
  checkName: 'Unit Tests',
  exitCode: 0,
  stdout: '42 passed, 0 failed, 0 skipped',
  stderr: '',
  duration: 3200,
  success: true,
  summary: 'All tests passed',
  detail: '42 test suites completed successfully',
  createdAt: '2026-06-01T14:19:00Z',
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const fixtureRepository: MesaRepository = {
  protocolVersion: '0.2.0',
  id: 'repo_r1r2r3r4',
  type: 'github',
  url: 'https://github.com/agentmesa/agentmesa',
  remoteUrl: 'https://github.com/agentmesa/agentmesa.git',
  defaultBranch: 'main',
  currentBranch: 'feature/qr-login',
  provider: 'github',
  providerMetadata: { org: 'agentmesa', repo: 'agentmesa' },
};
