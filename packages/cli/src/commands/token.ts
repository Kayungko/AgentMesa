import {
  createRuntimeContext,
  grantMemberToken,
  revokeMemberToken,
  listMemberTokens,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

/**
 * mesa token — per-member HTTP credentials (M3 phase 2, option B).
 *
 * Token fixes the identity; the agent registry fixes the permissions. Grant
 * and revoke run as the local operator (user:local / owner), matching the
 * operator channel every other privileged CLI command uses.
 */
export function runToken(args: ParsedArgs, ctxOverride?: MesaRuntimeContext): void {
  const ctx =
    ctxOverride ??
    createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'grant':
      case 'rotate': {
        // Rotation is just another grant: one agent holds at most one active
        // token, and re-granting overwrites — the old token dies immediately.
        const agentId = args.positional[0];
        if (!agentId) {
          console.log(`Usage: mesa token ${args.subcommand} <agentId>`);
          return;
        }
        const { token, record } = grantMemberToken(ctx, agentId);
        outputResult(
          { agentId: record.agentId, token },
          json,
          () => {
            printSuccess(`Token ${args.subcommand === 'rotate' ? 'rotated' : 'granted'} for ${record.agentId}`);
            if (args.subcommand === 'rotate') {
              console.log('  Previous token (if any) is now INVALID.');
            }
            console.log('  Token (save it now — it cannot be shown again):');
            console.log(`    ${token}`);
            console.log('  Use it as a Bearer token on MCP HTTP connections.');
          },
        );
        return;
      }

      case 'revoke': {
        const agentId = args.positional[0];
        if (!agentId) {
          console.log('Usage: mesa token revoke <agentId> [--reason <text>]');
          return;
        }
        const reason = typeof args.flags['reason'] === 'string' ? args.flags['reason'] : undefined;
        const summary = revokeMemberToken(ctx, agentId, reason);
        outputResult(summary, json, () => {
          printSuccess(`Token revoked for ${summary.agentId}`);
          console.log('  The agent\'s next HTTP request will be rejected (401).');
        });
        return;
      }

      case 'list': {
        const tokens = listMemberTokens(ctx);
        outputResult(tokens, json, () => {
          if (tokens.length === 0) {
            console.log('No member tokens. Grant one with: mesa token grant <agentId>');
          } else {
            console.log(`\n  ${'Agent'.padEnd(24)} ${'Granted At'.padEnd(26)} ${'Granted By'.padEnd(16)} Status`);
            console.log(`  ${'─'.repeat(24)} ${'─'.repeat(26)} ${'─'.repeat(16)} ${'─'.repeat(10)}`);
            for (const t of tokens) {
              console.log(
                `  ${t.agentId.padEnd(24)} ${t.grantedAt.padEnd(26)} ${t.grantedBy.padEnd(16)} ${t.revokedAt ? 'revoked' : 'active'}`,
              );
            }
            console.log(`\n  ${tokens.length} token(s)\n`);
          }
        });
        return;
      }

      default:
        console.log('Usage: mesa token <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  grant <agentId>        Issue a member token (the token is shown once)');
        console.log('  rotate <agentId>       Replace the member token (old one dies immediately)');
        console.log('  revoke <agentId>       Revoke the member token [--reason <text>]');
        console.log('  list                   List member tokens (never the token values)');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
