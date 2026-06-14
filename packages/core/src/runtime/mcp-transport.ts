import type { MesaTransportCapabilities } from '@agentmesa/protocol';
import type { MesaTransport } from './types.js';

const MCP_TRANSPORT_CAPABILITIES: MesaTransportCapabilities = {
  canCreateTasks: true,
  canReadTasks: true,
  canUpdateTaskStatus: true,
  canPostMessages: true,
  canAttachArtifacts: true,
  canCreateMeetings: true,
  canRegisterAgents: true,
  supportsPush: false,
  supportsBidirectional: false,
};

/**
 * MCP Transport — skeleton.
 *
 * Declares MCP capabilities and provides a placeholder for future MCP server
 * integration. `isAvailable()` returns `false` until full MCP lifecycle
 * integration is implemented.
 *
 * Future integration path:
 * - `@agentmesa/mcp-server` will construct an `MCPTransport` and register it
 *   with the transport registry via `registerTransport(ctx, transport)`.
 * - `isAvailable()` will check whether the MCP server is running.
 * - Inbox/outbox methods will bridge MCP tool invocations through the envelope
 *   protocol, mapping MCP request/response pairs to `TransportEnvelope` objects.
 */
export class MCPTransport implements MesaTransport {
  readonly name = 'MCP Transport';
  readonly type = 'mcp' as const;
  readonly capabilities = MCP_TRANSPORT_CAPABILITIES;
  readonly version = '2024-11-05';

  isAvailable(): boolean {
    return false;
  }
}
