/**
 * AgentMesa Protocol version constants and migration support.
 *
 * Every schema object carries a `protocolVersion` field so that readers
 * can detect stale data before parsing. Runtime code can use
 * `needsMigration()` and `migrateMesaObject()` to bring old objects
 * up to the current protocol version.
 */

/** The current protocol version (semver). */
export const currentProtocolVersion = '0.2.0' as const;

/** Protocol versions that the current runtime understands how to migrate FROM. */
export const supportedProtocolVersions = ['0.1.0', '0.2.0'] as const;

export type ProtocolVersion = (typeof supportedProtocolVersions)[number];

// ---------------------------------------------------------------------------
// Simple migration table (v0.1.0 -> v0.2.0)
// ---------------------------------------------------------------------------

interface MesaObjectLike {
  protocolVersion?: string;
  [key: string]: unknown;
}

interface MigrationIssue {
  field: string;
  message: string;
}

interface MigrationResult {
  version: string;
  migrated: boolean;
  issues: MigrationIssue[];
  data: MesaObjectLike;
}

/**
 * Returns true when the given object carries a known-but-stale protocol version.
 */
export function needsMigration(obj: MesaObjectLike): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (!obj.protocolVersion || typeof obj.protocolVersion !== 'string') return false;
  return (
    supportedProtocolVersions.includes(obj.protocolVersion as ProtocolVersion) &&
    obj.protocolVersion !== currentProtocolVersion
  );
}

/**
 * Migrate a MesaObject from `fromVersion` to `toVersion` in-place.
 *
 * Currently only v0.1.0 -> v0.2.0 is implemented.
 */
export function migrateMesaObject(
  from: string,
  to: string,
  obj: MesaObjectLike,
): MesaObjectLike {
  if (from === to) return obj;

  // Only one migration path exists today (0.1.0 -> 0.2.0)
  if (from === '0.1.0' && to === '0.2.0') {
    return migrate_v0_1_0_to_v0_2_0(obj);
  }

  throw new Error(
    `Unsupported migration path: ${from} -> ${to}`,
  );
}

/**
 * Attempt to upgrade a MesaObject from any supported older version to the
 * current version. Returns a result describing what happened.
 */
export function migrateToCurrent(obj: MesaObjectLike): MigrationResult {
  const issues: MigrationIssue[] = [];

  if (!obj.protocolVersion || typeof obj.protocolVersion !== 'string') {
    return {
      version: currentProtocolVersion,
      migrated: false,
      issues: [{ field: 'protocolVersion', message: 'Missing or invalid protocolVersion' }],
      data: obj,
    };
  }

  const from = obj.protocolVersion;

  if (from === currentProtocolVersion) {
    return { version: currentProtocolVersion, migrated: false, issues: [], data: obj };
  }

  if (!supportedProtocolVersions.includes(from as ProtocolVersion)) {
    return {
      version: currentProtocolVersion,
      migrated: false,
      issues: [{ field: 'protocolVersion', message: `Unsupported version: ${from}` }],
      data: obj,
    };
  }

  try {
    const migrated = migrateMesaObject(from, currentProtocolVersion, { ...obj });
    return { version: currentProtocolVersion, migrated: true, issues, data: migrated };
  } catch (err) {
    issues.push({
      field: 'protocolVersion',
      message: err instanceof Error ? err.message : 'Migration failed',
    });
    return { version: currentProtocolVersion, migrated: false, issues, data: obj };
  }
}

// ---------------------------------------------------------------------------
// v0.1.0 -> v0.2.0 migration
// ---------------------------------------------------------------------------

function migrate_v0_1_0_to_v0_2_0(obj: MesaObjectLike): MesaObjectLike {
  const result = { ...obj, protocolVersion: '0.2.0' as const };

  // meetingId is now required on tasks — if missing, clear the field so
  // downstream schemas will reject (caller must supply a meeting).
  // We intentionally do NOT fabricate a meetingId.

  return result;
}
