import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createRuntimeContext,
  initWorkspace,
  listAgents,
  createRoomStore,
  REMOTE_WORKSPACE_ID,
  PolicyDeniedError,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaAgent, MesaRoom } from '@agentmesa/protocol';
import { handleRegisterRemoteMember } from '../tools.js';

let testDir: string;
let ctx: MesaRuntimeContext;
let homeDir: string;
const prevHome = process.env['AGENTMESA_HOME'];

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-remote-mcp-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'agent:codex', type: 'agent', roles: ['builder'], client: 'mcp' },
  });
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-remote-home-'));
  process.env['AGENTMESA_HOME'] = homeDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(testDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe('handleRegisterRemoteMember', () => {
  it('registers a remote agent in the agent registry with client "remote"', () => {
    const result = JSON.parse(handleRegisterRemoteMember(ctx, {
      id: 'remote-bot',
      name: 'Remote Bot',
      endpoint: 'https://example.com/mcp',
    })) as { agent: MesaAgent };

    expect(result.agent.id).toBe('remote-bot');
    expect(result.agent.client).toBe('remote');
    expect(result.agent.metadata?.['endpoint']).toBe('https://example.com/mcp');

    const agents = listAgents(ctx);
    expect(agents.some((a) => a.id === 'remote-bot')).toBe(true);
  });

  it('denies a builder registering a remote member with privileged roles', () => {
    // Same privileged-role fence as handleRegisterAgent: a builder-level
    // actor must not be able to mint an owner/admin remote member (2026-09-03
    // hardening — see docs/SECURITY.md HTTP identity boundary).
    expect(() =>
      handleRegisterRemoteMember(ctx, {
        id: 'remote-kingpin',
        name: 'Remote Kingpin',
        roles: ['owner'],
      })
    ).toThrow(/privileged/);
  });

  it('defaults roles to builder when omitted', () => {
    const result = JSON.parse(handleRegisterRemoteMember(ctx, {
      id: 'remote-bot',
      name: 'Remote Bot',
    })) as { agent: MesaAgent };
    expect(result.agent.roles).toEqual(['builder']);
  });

  it('invites the remote agent into a room under the reserved remote workspace', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '跨机房协作群' });

    const result = JSON.parse(handleRegisterRemoteMember(ctx, {
      id: 'remote-bot',
      name: 'Remote Bot',
      roles: ['reviewer'],
      roomId: room.id,
    })) as { agent: MesaAgent; room: MesaRoom };

    expect(result.room.id).toBe(room.id);
    expect(result.room.members).toHaveLength(1);
    const member = result.room.members[0]!;
    expect(member.workspaceId).toBe(REMOTE_WORKSPACE_ID);
    expect(member.kind).toBe('agent');
    expect(member.ref).toBe('remote-bot');
    expect(member.label).toBe('Remote Bot');
    expect(member.roles).toEqual(['reviewer']);
  });

  it('lets the remote member speak through the room store under its actor ref', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '群' });
    handleRegisterRemoteMember(ctx, {
      id: 'remote-bot',
      name: 'Remote Bot',
      roomId: room.id,
    });

    // The remote agent connects with actor "agent:remote-bot" — its
    // normalized ref ("remote-bot") must satisfy the impersonation check.
    const message = store.sendMessage(room.id, {
      workspaceId: REMOTE_WORKSPACE_ID,
      from: { workspaceId: REMOTE_WORKSPACE_ID, kind: 'agent', ref: 'remote-bot' },
      summary: '来自远端的第一条消息',
    }, { actorRef: 'remote-bot' });
    expect(message.summary).toBe('来自远端的第一条消息');

    // A different actor cannot speak on its behalf.
    expect(() => store.sendMessage(room.id, {
      workspaceId: REMOTE_WORKSPACE_ID,
      from: { workspaceId: REMOTE_WORKSPACE_ID, kind: 'agent', ref: 'remote-bot' },
      summary: '冒充远端成员',
    }, { actorRef: 'someone-else' })).toThrow(/impersonation rejected/);
  });

  it('rejects an unknown room id', () => {
    expect(() => handleRegisterRemoteMember(ctx, {
      id: 'remote-bot',
      name: 'Remote Bot',
      roomId: 'room_missing',
    })).toThrow(/Room not found/);
  });

  it('is policy-gated: a read_only actor cannot register remote members', () => {
    const readOnlyCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:viewer', type: 'agent', roles: ['read_only'], client: 'mcp' },
    });
    expect(() => handleRegisterRemoteMember(readOnlyCtx, {
      id: 'remote-bot',
      name: 'Remote Bot',
    })).toThrow(PolicyDeniedError);
  });
});
