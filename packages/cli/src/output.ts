import { MesaError } from '@agentmesa/core';

export function printSuccess(message: string): void {
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

export function printError(error: unknown): void {
  if (error instanceof MesaError) {
    console.error(`\x1b[31m✗ ${error.name}:\x1b[0m ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`\x1b[31m✗ Error:\x1b[0m ${error.message}`);
  } else {
    console.error(`\x1b[31m✗ Error:\x1b[0m ${String(error)}`);
  }
}

export function printWarning(message: string): void {
  console.log(`\x1b[33m⚠\x1b[0m ${message}`);
}

export function printInfo(message: string): void {
  console.log(`\x1b[36mℹ\x1b[0m ${message}`);
}

/**
 * Output data in either JSON or human-readable format.
 * When json=true, only JSON goes to stdout — safe for local AI consumption.
 */
export function outputResult(data: unknown, json: boolean, humanRenderer?: () => void): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (humanRenderer) {
    humanRenderer();
    return;
  }
  formatOutput(data, false);
}

export function formatOutput(data: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log('  (empty)');
      return;
    }
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        printObjectRow(item as Record<string, unknown>);
      } else {
        console.log(`  ${String(item)}`);
      }
    }
    return;
  }

  if (typeof data === 'object' && data !== null) {
    printObjectDetail(data as Record<string, unknown>);
    return;
  }

  console.log(`  ${String(data)}`);
}

function printObjectRow(obj: Record<string, unknown>): void {
  const keys = Object.keys(obj).slice(0, 5);
  const parts = keys.map((k) => `${k}: ${String(obj[k]).slice(0, 40)}`);
  console.log(`  ${parts.join('  ')}`);
}

function printObjectDetail(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
    console.log(`  \x1b[36m${key}:\x1b[0m ${display}`);
  }
}
