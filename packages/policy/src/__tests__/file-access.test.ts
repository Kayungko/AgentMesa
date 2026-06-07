import { describe, it, expect } from 'vitest';
import { FileAccessChecker } from '../file-access.js';

const checker = new FileAccessChecker();

describe('FileAccessChecker.canAccess', () => {
  it('builder can modify source files', () => {
    expect(checker.canAccess('src/index.ts', 'builder')).toBe(true);
    expect(checker.canAccess('src/utils.js', 'builder')).toBe(true);
  });

  it('reviewer cannot modify source files', () => {
    expect(checker.canAccess('src/index.ts', 'reviewer')).toBe(false);
    expect(checker.canAccess('src/utils.js', 'reviewer')).toBe(false);
  });

  it('builder cannot modify .agentmesa/ state', () => {
    expect(checker.canAccess('.agentmesa/config.json', 'builder')).toBe(false);
    expect(checker.canAccess('.agentmesa/tasks/abc.json', 'builder')).toBe(false);
  });

  it('chair can access .agentmesa/ state', () => {
    expect(checker.canAccess('.agentmesa/config.json', 'chair')).toBe(true);
  });

  it('maintainer can access .agentmesa/ state', () => {
    expect(checker.canAccess('.agentmesa/config.json', 'maintainer')).toBe(true);
  });

  it('all roles can read non-source files', () => {
    expect(checker.canAccess('README.md', 'reviewer')).toBe(true);
    expect(checker.canAccess('package.json', 'tester')).toBe(true);
  });
});

describe('FileAccessChecker.isSecretPath', () => {
  it('detects .env files', () => {
    expect(checker.isSecretPath('.env')).toBe(true);
    expect(checker.isSecretPath('.env.local')).toBe(true);
    expect(checker.isSecretPath('.env.production')).toBe(true);
  });

  it('detects .ssh paths', () => {
    expect(checker.isSecretPath('/home/user/.ssh/id_rsa')).toBe(true);
  });

  it('detects credentials paths', () => {
    expect(checker.isSecretPath('config/credentials.json')).toBe(true);
  });

  it('detects secrets and keys directories', () => {
    expect(checker.isSecretPath('secrets/api.json')).toBe(true);
    expect(checker.isSecretPath('keys/private.pem')).toBe(true);
    expect(checker.isSecretPath('tokens/github.txt')).toBe(true);
  });

  it('does not flag normal paths', () => {
    expect(checker.isSecretPath('src/index.ts')).toBe(false);
    expect(checker.isSecretPath('README.md')).toBe(false);
    expect(checker.isSecretPath('package.json')).toBe(false);
  });
});

describe('FileAccessChecker with custom rules', () => {
  it('respects custom rules', () => {
    const custom = new FileAccessChecker([
      {
        pattern: '**/*.ts',
        allow: ['chair'],
        deny: ['builder'],
      },
    ]);

    expect(custom.canAccess('src/index.ts', 'chair')).toBe(true);
    expect(custom.canAccess('src/index.ts', 'builder')).toBe(false);
  });
});
