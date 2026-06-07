import { describe, it, expect } from 'vitest';
import { SecretProtection } from '../secret-protection.js';

const protection = new SecretProtection();

describe('SecretProtection.isSecretPath', () => {
  it('detects .env files', () => {
    expect(protection.isSecretPath('.env')).toBe(true);
    expect(protection.isSecretPath('.env.local')).toBe(true);
  });

  it('detects ssh paths', () => {
    expect(protection.isSecretPath('/home/user/.ssh/id_rsa')).toBe(true);
  });

  it('does not flag normal paths', () => {
    expect(protection.isSecretPath('src/index.ts')).toBe(false);
    expect(protection.isSecretPath('README.md')).toBe(false);
  });
});

describe('SecretProtection.isSecretContent', () => {
  it('detects API keys', () => {
    expect(protection.isSecretContent('API_KEY=sk_12345abcde')).toBe(true);
  });

  it('detects passwords', () => {
    expect(protection.isSecretContent('PASSWORD=mysecretpass')).toBe(true);
  });

  it('detects tokens', () => {
    expect(protection.isSecretContent('TOKEN=abc123def456')).toBe(true);
  });

  it('detects private keys', () => {
    expect(protection.isSecretContent('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    expect(protection.isSecretContent('-----BEGIN PRIVATE KEY-----')).toBe(true);
  });

  it('detects Stripe live keys', () => {
    const key = ['sk', 'live', 'FAKEEXAMPLEKEY1234567890zz'].join('_');
    expect(protection.isSecretContent(key)).toBe(true);
  });

  it('detects Stripe test keys', () => {
    const key = ['sk', 'test', 'FAKEEXAMPLEKEY1234567890zz'].join('_');
    expect(protection.isSecretContent(key)).toBe(true);
  });

  it('detects GitHub tokens', () => {
    const token = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    expect(protection.isSecretContent(token)).toBe(true);
  });

  it('detects AWS access keys', () => {
    const key = 'AKIA' + 'IOSFODNN7EXAMPLE';
    expect(protection.isSecretContent(key)).toBe(true);
  });

  it('detects Slack tokens', () => {
    const token = ['xoxb', '000000000', 'FAKEFAKETOKEN1234'].join('-');
    expect(protection.isSecretContent(token)).toBe(true);
  });

  it('does not flag non-secret content', () => {
    expect(protection.isSecretContent('Hello, world!')).toBe(false);
    expect(protection.isSecretContent('const x = 42;')).toBe(false);
    expect(protection.isSecretContent('import { foo } from "bar";')).toBe(false);
  });
});

describe('SecretProtection.sanitizeContent', () => {
  it('redacts API keys', () => {
    const result = protection.sanitizeContent('API_KEY=sk_12345abcde');
    expect(result).toContain('API_KEY=');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk_12345abcde');
  });

  it('redacts passwords', () => {
    const result = protection.sanitizeContent('PASSWORD=mysecretpass');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('mysecretpass');
  });

  it('redacts private keys', () => {
    const result = protection.sanitizeContent('-----BEGIN RSA PRIVATE KEY-----');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Stripe keys', () => {
    const key = 'key: ' + ['sk', 'live', 'FAKEEXAMPLEKEY1234567890zz'].join('_');
    const result = protection.sanitizeContent(key);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('FAKEEXAMPLE');
  });

  it('redacts GitHub tokens', () => {
    const token = 'token: ' + 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = protection.sanitizeContent(token);
    expect(result).toContain('[REDACTED]');
  });

  it('passes through non-secret content unchanged', () => {
    const input = 'Hello, world!\nconst x = 42;';
    const result = protection.sanitizeContent(input);
    expect(result).toBe(input);
  });

  it('redacts multiple secrets in same content', () => {
    const input = 'API_KEY=sk_12345abcde\nPASSWORD=secret123';
    const result = protection.sanitizeContent(input);
    expect(result).not.toContain('sk_12345abcde');
    expect(result).not.toContain('secret123');
  });
});
