import { describe, it, expect } from 'vitest';
import {
  currentProtocolVersion,
  supportedProtocolVersions,
  needsMigration,
  migrateMesaObject,
  migrateToCurrent,
} from '../version.js';

describe('currentProtocolVersion', () => {
  it('is 0.2.0', () => {
    expect(currentProtocolVersion).toBe('0.2.0');
  });
});

describe('supportedProtocolVersions', () => {
  it('includes 0.1.0 and 0.2.0', () => {
    expect(supportedProtocolVersions).toContain('0.1.0');
    expect(supportedProtocolVersions).toContain('0.2.0');
  });

  it('does not include unknown versions', () => {
    expect(supportedProtocolVersions).not.toContain('0.3.0');
    expect(supportedProtocolVersions).not.toContain('1.0.0');
  });
});

describe('needsMigration', () => {
  it('returns false for null/undefined/non-objects', () => {
    expect(needsMigration(null as unknown as Record<string, unknown>)).toBe(false);
    expect(needsMigration(undefined as unknown as Record<string, unknown>)).toBe(false);
    expect(needsMigration('string' as unknown as Record<string, unknown>)).toBe(false);
  });

  it('returns false for missing protocolVersion', () => {
    expect(needsMigration({})).toBe(false);
    expect(needsMigration({ id: 'test' })).toBe(false);
  });

  it('returns false for current version', () => {
    expect(needsMigration({ protocolVersion: '0.2.0' })).toBe(false);
  });

  it('returns true for older supported version', () => {
    expect(needsMigration({ protocolVersion: '0.1.0' })).toBe(true);
  });

  it('returns false for unsupported version', () => {
    expect(needsMigration({ protocolVersion: '0.3.0' })).toBe(false);
  });
});

describe('migrateMesaObject', () => {
  it('returns unchanged if from === to', () => {
    const obj = { protocolVersion: '0.1.0', id: 'test' };
    const result = migrateMesaObject('0.1.0', '0.1.0', obj);
    expect(result).toBe(obj);
  });

  it('migrates from 0.1.0 to 0.2.0', () => {
    const obj = {
      protocolVersion: '0.1.0',
      id: 'task_old001',
      title: 'Test',
    };
    const result = migrateMesaObject('0.1.0', '0.2.0', obj);
    expect(result.protocolVersion).toBe('0.2.0');
    expect(result.id).toBe('task_old001');
    expect(result.title).toBe('Test');
  });

  it('throws for unsupported migration path', () => {
    const obj = { protocolVersion: '0.1.0' };
    expect(() => migrateMesaObject('0.2.0', '0.3.0' as string, obj)).toThrow(
      'Unsupported migration path'
    );
  });
});

describe('migrateToCurrent', () => {
  it('returns not-migrated for current version', () => {
    const result = migrateToCurrent({ protocolVersion: '0.2.0', id: 'test' });
    expect(result.version).toBe('0.2.0');
    expect(result.migrated).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  it('migrates from 0.1.0 to current', () => {
    const result = migrateToCurrent({ protocolVersion: '0.1.0', id: 'test' });
    expect(result.version).toBe('0.2.0');
    expect(result.migrated).toBe(true);
    expect(result.data.protocolVersion).toBe('0.2.0');
  });

  it('returns error for missing protocolVersion', () => {
    const result = migrateToCurrent({ id: 'test' });
    expect(result.migrated).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]!.field).toBe('protocolVersion');
  });

  it('returns error for unsupported version', () => {
    const result = migrateToCurrent({ protocolVersion: '0.3.0' });
    expect(result.migrated).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
