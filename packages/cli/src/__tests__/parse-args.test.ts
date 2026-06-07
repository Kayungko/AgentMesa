import { describe, it, expect } from 'vitest';
import { parseArgs } from '../parse-args.js';

describe('parseArgs', () => {
  it('parses help with no args', () => {
    const result = parseArgs(['node', 'mesa']);
    expect(result.command).toBe('help');
    expect(result.subcommand).toBe('');
    expect(result.positional).toEqual([]);
    expect(result.flags).toEqual({});
  });

  it('parses simple command', () => {
    const result = parseArgs(['node', 'mesa', 'init']);
    expect(result.command).toBe('init');
    expect(result.subcommand).toBe('');
  });

  it('parses command + subcommand', () => {
    const result = parseArgs(['node', 'mesa', 'task', 'list']);
    expect(result.command).toBe('task');
    expect(result.subcommand).toBe('list');
  });

  it('parses positional arguments', () => {
    const result = parseArgs(['node', 'mesa', 'task', 'create', 'My task title']);
    expect(result.command).toBe('task');
    expect(result.subcommand).toBe('create');
    expect(result.positional).toEqual(['My task title']);
  });

  it('parses --json flag', () => {
    const result = parseArgs(['node', 'mesa', 'task', 'list', '--json']);
    expect(result.flags['json']).toBe(true);
  });

  it('parses --help flag', () => {
    const result = parseArgs(['node', 'mesa', 'task', '--help']);
    expect(result.flags['help']).toBe(true);
  });

  it('parses -h shorthand', () => {
    const result = parseArgs(['node', 'mesa', '-h']);
    expect(result.flags['help']).toBe(true);
  });

  it('parses named flags with values', () => {
    const result = parseArgs(['node', 'mesa', 'task', 'create', 'Title', '--assignee', 'claude', '--reviewer', 'codex']);
    expect(result.flags['assignee']).toBe('claude');
    expect(result.flags['reviewer']).toBe('codex');
    expect(result.positional).toEqual(['Title']);
  });

  it('parses multiple positional args', () => {
    const result = parseArgs(['node', 'mesa', 'task', 'status', 'T-0001', 'in_progress']);
    expect(result.positional).toEqual(['T-0001', 'in_progress']);
  });

  it('handles --task flag for filtering', () => {
    const result = parseArgs(['node', 'mesa', 'message', 'list', '--task', 'T-0001']);
    expect(result.flags['task']).toBe('T-0001');
  });
});
