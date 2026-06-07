import { describe, it, expect } from 'vitest';
import { parseRunOutput, extractChangedFiles } from '../output-parser.js';

describe('parseRunOutput', () => {
  it('extracts summary from first line', () => {
    const output = 'Task completed successfully\nSome details here';
    const result = parseRunOutput(output);
    expect(result.summary).toBe('Task completed successfully');
  });

  it('handles empty output', () => {
    const result = parseRunOutput('');
    expect(result.summary).toBe('');
    expect(result.changedFiles).toBeUndefined();
    expect(result.issues).toBeUndefined();
  });

  it('extracts changed files from output', () => {
    const output =
      'Implementation complete\n- modified: src/auth/login.ts\n- created: src/auth/qr.ts';
    const result = parseRunOutput(output);
    expect(result.summary).toBe('Implementation complete');
    expect(result.changedFiles).toContain('src/auth/login.ts');
    expect(result.changedFiles).toContain('src/auth/qr.ts');
  });

  it('extracts issues from output', () => {
    const output =
      'Review completed\n- issue: Missing error handling\n- warning: No rate limiting';
    const result = parseRunOutput(output);
    expect(result.issues).toBeDefined();
    expect(result.issues).toContain('Missing error handling');
    expect(result.issues).toContain('No rate limiting');
  });

  it('returns undefined for optional fields when not found', () => {
    const output = 'Just a simple summary';
    const result = parseRunOutput(output);
    expect(result.changedFiles).toBeUndefined();
    expect(result.issues).toBeUndefined();
  });
});

describe('extractChangedFiles', () => {
  it('extracts files with modified/created/deleted patterns', () => {
    const output = 'modified: src/index.ts\ncreated: src/utils.ts\ndeleted: old/file.js';
    const files = extractChangedFiles(output);
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/utils.ts');
    expect(files).toContain('old/file.js');
  });

  it('extracts files from list format', () => {
    const output = 'Changed files:\n- src/auth/login.ts\n- src/auth/register.ts';
    const files = extractChangedFiles(output);
    expect(files).toContain('src/auth/login.ts');
    expect(files).toContain('src/auth/register.ts');
  });

  it('returns empty array when no files found', () => {
    const output = 'No files were changed in this run';
    const files = extractChangedFiles(output);
    expect(files).toEqual([]);
  });

  it('deduplicates files', () => {
    const output = 'modified: src/index.ts\nfile: src/index.ts';
    const files = extractChangedFiles(output);
    const uniqueFiles = [...new Set(files)];
    expect(files.length).toBe(uniqueFiles.length);
  });
});
