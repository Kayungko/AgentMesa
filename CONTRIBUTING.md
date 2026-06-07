# Contributing to AgentMesa

Thank you for your interest in contributing to AgentMesa! This document provides guidelines and information for contributors.

## Development Environment Setup

### Prerequisites

- Node.js >= 20.11.0
- pnpm 9.x

### Getting Started

```bash
# Clone the repository
git clone https://github.com/agentmesa/agentmesa.git
cd agentmesa

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type-check all packages
pnpm typecheck
```

## Package Structure

AgentMesa is organized as a pnpm workspace monorepo with the following structure:

### Core Packages

- **`@agentmesa/protocol`** - Mesa Protocol types, zod schemas, and status lifecycle definitions
- **`@agentmesa/core`** - Core infrastructure, workspace management, and service layer
- **`@agentmesa/cli`** - Command-line interface (`mesa` command)
- **`@agentmesa/runner`** - Task runner and execution engine
- **`@agentmesa/mcp-server`** - Model Context Protocol server implementation
- **`@agentmesa/orchestrator`** - Multi-agent orchestration and coordination
- **`@agentmesa/policy`** - Policy engine and governance rules

### Connectors

- **`@agentmesa/connector-git`** - Git repository integration
- **`@agentmesa/connector-shell`** - Shell command execution connector

### Plugins

- **`@agentmesa/plugin-claude`** - Claude Code plugin (CLAUDE.md, MCP config, skills)
- **`@agentmesa/plugin-codex`** - OpenAI Codex plugin (AGENTS.md, hooks)

## Adding a New Package

1. Create a new directory under `packages/` (or `plugins/` for plugins):

```bash
mkdir packages/my-package/src
```

2. Create `package.json`:

```json
{
  "name": "@agentmesa/my-package",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "author": "AgentMesa Contributors",
  "repository": {
    "type": "git",
    "url": "https://github.com/agentmesa/agentmesa",
    "directory": "packages/my-package"
  },
  "keywords": ["agentmesa", "ai-agents", "claude-code", "codex", "mcp"],
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

3. Create `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

4. Create `src/index.ts` with your package entry point.

5. Run `pnpm install` to link the new workspace package.

## Testing Conventions

- Tests are co-located with source code in `__tests__/` directories
- Test files follow the pattern `*.test.ts`
- Use `vitest` as the test runner
- Run tests with `pnpm test` (all packages) or `pnpm --filter @agentmesa/my-package test` (single package)
- Aim for high test coverage on protocol types and core logic
- Use `expect-type` for compile-time type assertions where appropriate

### Example Test

```typescript
import { describe, it, expect } from 'vitest';

describe('myModule', () => {
  it('should do something', () => {
    expect(myFunction()).toBe(expected);
  });
});
```

## Code Style

### Module System

- **ESM only** - All packages use `"type": "module"`
- Use `import`/`export` syntax (no CommonJS `require`)
- TypeScript module resolution: **NodeNext**

### Import Paths

- Always use `.js` extensions in import paths (required for ESM + NodeNext):

```typescript
// Correct
import { something } from './module.js';
import { other } from '../utils/helper.js';

// Incorrect - will fail at runtime
import { something } from './module';
import { other } from '../utils/helper';
```

### TypeScript

- Strict mode enabled in root `tsconfig.json`
- Use `tsup` for building (ESM format with declaration files)
- Prefer interfaces over type aliases for object shapes
- Use discriminated unions for protocol message types

### Naming Conventions

- Package names: `@agentmesa/<name>` (kebab-case)
- File names: kebab-case (`my-module.ts`)
- Type names: PascalCase (`TaskStatus`, `MesaMessage`)
- Function/variable names: camelCase (`createWorkspace`, `taskCount`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_TIMEOUT`)

## PR Process

1. **Fork** the repository and create a feature branch from `main`
2. **Make changes** following the code style guidelines above
3. **Add tests** for new functionality
4. **Run checks** before committing:
   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   ```
5. **Commit** with a clear, descriptive message following conventional commits:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `refactor:` for code refactoring
   - `test:` for adding tests
   - `chore:` for maintenance tasks
6. **Open a PR** against `main` with a clear description of changes
7. **Address review feedback** and ensure CI passes

### PR Requirements

- All CI checks must pass (typecheck, test, build)
- New features should include tests
- Breaking changes should be documented
- Large changes should be discussed in an issue first

## Questions?

Open an issue on GitHub if you have questions or need help getting started.
