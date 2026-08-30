import { expect } from 'vitest';
import {
  ToolError,
  TOOL_ERROR_CODES,
  type ToolErrorDetails,
  type ToolErrorResult,
} from '../tool-errors.js';

/**
 * Test-side contract helpers: every user-visible tool failure must carry the
 * three self-repair elements — WHAT failed (with the actual values received),
 * WHY (an error category), and a concrete FIX. Use these in new tool tests so
 * the contract cannot silently regress.
 */

/** Assert that `fn` throws a ToolError satisfying the what/why/fix contract. */
export async function expectToolError(fn: () => unknown): Promise<ToolError> {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected the handler to throw').toBeDefined();
  expect(caught).toBeInstanceOf(ToolError);
  const error = caught as ToolError;
  expectContractDetails({
    tool: error.tool,
    code: error.code,
    what: error.what,
    why: error.why,
    fix: error.fix,
    message: error.message,
  });
  return error;
}

/** Assert that an MCP isError result satisfies the what/why/fix contract. */
export function expectToolErrorResult(result: ToolErrorResult): ToolErrorDetails {
  expect(result.isError).toBe(true);
  expect(result.content).toHaveLength(1);
  expect(result.content[0]!.type).toBe('text');
  const parsed = JSON.parse(result.content[0]!.text) as { error: ToolErrorDetails };
  expect(parsed.error).toBeDefined();
  expectContractDetails(parsed.error);
  // The envelope names the failing tool so the agent knows what to re-call.
  expect(parsed.error.tool).toMatch(/^mesa_[a-z_]+$/);
  return parsed.error;
}

/** The three-element contract itself, applied to any error details shape. */
function expectContractDetails(details: ToolErrorDetails): void {
  // what — non-trivial description of the failing parameter/resource. Tests
  // for specific tools additionally assert the actual value appears in it.
  expect(details.what.trim().length).toBeGreaterThan(10);
  // why — a known error category.
  expect(TOOL_ERROR_CODES).toContain(details.code);
  expect(details.why.trim().length).toBeGreaterThan(0);
  // fix — a concrete, actionable instruction (not just a restatement).
  expect(details.fix.trim().length).toBeGreaterThan(10);
  expect(details.fix).toMatch(/[a-z]/);
}
