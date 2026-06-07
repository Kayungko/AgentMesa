import { mesaProtocolVersion } from './types.js';
import type { MesaAgent, MesaTask, MesaMessage, MesaArtifact, MesaMeeting } from './types.js';

export const fixtureBuilderAgent: MesaAgent = {
  id: 'agent-claude-001',
  name: 'Claude Code',
  client: 'claude-code',
  roles: ['builder', 'planner', 'documenter'],
};

export const fixtureReviewerAgent: MesaAgent = {
  id: 'agent-codex-001',
  name: 'Codex',
  client: 'codex',
  roles: ['reviewer', 'tester'],
};

export const fixtureTask: MesaTask = {
  protocolVersion: mesaProtocolVersion,
  id: 'T-0001',
  title: 'Implement QR login',
  status: 'ready_for_review',
  createdBy: 'user',
  assignedTo: 'agent-claude-001',
  reviewer: 'agent-codex-001',
  branch: 'feature/qr-login',
  context: {
    goal: 'Add QR code based login flow with redirect',
    changedFiles: ['src/auth/qr-login.ts', 'src/auth/qr-scanner.tsx'],
    commands: ['npm test', 'npm run lint'],
  },
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-01T14:30:00Z',
};

export const fixtureMessage: MesaMessage = {
  protocolVersion: mesaProtocolVersion,
  id: 'M-0001',
  taskId: 'T-0001',
  from: 'agent-claude-001',
  to: 'agent-codex-001',
  type: 'review_request',
  summary: 'QR login implementation complete. Ready for review.',
  artifactIds: ['A-0001'],
  createdAt: '2026-06-01T14:30:00Z',
};

export const fixtureReviewArtifact: MesaArtifact = {
  protocolVersion: mesaProtocolVersion,
  id: 'A-0001',
  kind: 'implementation_summary',
  taskId: 'T-0001',
  createdBy: 'agent-claude-001',
  content: '# Implementation Summary: QR Login\n\nImplemented QR code login flow with scanner component and auth handler.',
  format: 'markdown',
  createdAt: '2026-06-01T14:25:00Z',
};

export const fixtureMeeting: MesaMeeting = {
  protocolVersion: mesaProtocolVersion,
  id: 'MTG-0001',
  title: 'QR Login Feature',
  status: 'open',
  tasks: ['T-0001'],
  agents: ['agent-claude-001', 'agent-codex-001'],
  createdAt: '2026-06-01T09:00:00Z',
  updatedAt: '2026-06-01T14:30:00Z',
};

export const fixtureReviewReport: MesaArtifact = {
  protocolVersion: mesaProtocolVersion,
  id: 'A-0002',
  kind: 'review_report',
  taskId: 'T-0001',
  createdBy: 'agent-codex-001',
  content: '# Review Report: QR Login\n\n## Result: Changes Requested\n\n- Missing input validation on QR payload\n- No rate limiting on scan attempts',
  format: 'markdown',
  metadata: { verdict: 'changes_requested', issuesFound: 2 },
  createdAt: '2026-06-01T16:00:00Z',
};
