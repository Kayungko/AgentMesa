import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export interface CliInvocation {
  /** Env value, split (whitelist tokenizer, no shell semantics) into program + fixed args (e.g. `claude -p`). */
  command: string;
  /** Delivered via stdin — never as a shell string, so prompts can't inject. */
  prompt: string;
  cwd: string;
  timeout?: number;
  /**
   * Called immediately after spawn so a long-lived host can track the child
   * (e.g. the desk killing in-flight session CLIs on shutdown).
   */
  onSpawn?: (child: ChildProcess) => void;
}

export interface CliResult {
  output: string;
  success: boolean;
}

// --- 安全的命令解析与构造（绝无 shell:true） ---
//
// `command` 来自 env（AGENTMESA_CLAUDE_CMD / AGENTMESA_CODEX_CMD）或
// config.runners，属于不可信输入。旧实现把整串命令交给 `shell:true` 的
// cmd.exe 解释，配置值里混入 `& whoami` 之类内容即被注入执行。现在：
// 1. 白名单式 tokenizer 拆出 program + args，不做任何 shell 语义解释；
// 2. Windows 上必须经 cmd.exe（npm CLI 是 .cmd shim，Node 自
//    CVE-2024-27980 起禁止无 shell 直接 spawn .bat/.cmd），但命令行由我们
//    逐 token 加引号拼接后通过 `/d /s /c` 传入，元字符对 cmd 全是字面量。

/** 引号外允许出现的字符：文件名、路径、flag 的常见安全子集。 */
const UNQUOTED_CHAR = /[A-Za-z0-9._\-/:=\\@#~,+]/;

/**
 * 白名单式命令行 tokenizer：
 * - 双引号包裹含空格的片段（如 `"C:\Program Files\cli\app.exe" -p`），引号
 *   本身不进入 token；
 * - 引号外只允许 `UNQUOTED_CHAR`，shell 元字符（& | ; < > ` ( ) ^ …）一律
 *   拒绝；`%` 与 `!` 连引号内也拒绝——cmd 的 %VAR% 展开与延迟展开不认引号；
 * - 未闭合引号、空命令同样拒绝。
 * 解析失败直接抛错，由调用方折叠为失败的 CliResult，绝不降级走 shell。
 */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasToken = false;
  const push = (): void => {
    if (hasToken) {
      tokens.push(current);
      current = '';
      hasToken = false;
    }
  };
  for (const char of command.trim()) {
    if (char === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
      continue;
    }
    if (char === '%' || char === '!') {
      throw new Error(`Unsafe character "${char}" in CLI command (cmd expansion metacharacter): ${command}`);
    }
    if (!inQuotes && /\s/.test(char)) {
      push();
      continue;
    }
    if (!inQuotes && !UNQUOTED_CHAR.test(char)) {
      throw new Error(`Unsafe character "${char}" in CLI command (shell metacharacters are not allowed): ${command}`);
    }
    current += char;
    hasToken = true;
  }
  if (inQuotes) {
    throw new Error(`Unterminated quote in CLI command: ${command}`);
  }
  push();
  if (tokens.length === 0) {
    throw new Error(`Empty CLI command: ${command}`);
  }
  return tokens;
}

/**
 * 把 token 包成 cmd.exe 命令行的带引号片段。token 里的 `"` 已被 tokenizer
 * 剥掉、`%`/`!` 已被拒绝，因此引号内的其余字符（& | < > ( ) ^ …）对 cmd 全
 * 是字面量，不会被解释成命令分隔符。唯一要补的是结尾反斜杠：CRT 参数解析
 * 里 `\"` 是转义引号，闭合引号前的反斜杠必须翻倍。
 */
function quoteCmdToken(token: string): string {
  return `"${token.replace(/(\\+)$/, '$1$1')}"`;
}

interface SpawnTarget {
  file: string;
  args: string[];
  /** win32 cmd.exe 路径需要参数逐字传递，避免 node 二次加引号/转义。 */
  windowsVerbatimArguments?: boolean;
}

/**
 * 把命令字符串解析成无 shell 的 spawn 目标。
 * - POSIX：program + args 直接 spawn；
 * - win32：经 `cmd.exe /d /s /c "<逐 token 加引号的命令行>"` 执行。`/s`
 *   让 cmd 剥掉我们外层包裹的一对引号、保留内部逐 token 的引号。
 */
function resolveSpawnTarget(command: string): SpawnTarget {
  const tokens = tokenizeCommand(command);
  if (process.platform !== 'win32') {
    return { file: tokens[0]!, args: tokens.slice(1) };
  }
  const commandLine = tokens.map(quoteCmdToken).join(' ');
  return {
    file: process.env['ComSpec'] ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

export function runCli(inv: CliInvocation): CliResult {
  let target: SpawnTarget;
  try {
    target = resolveSpawnTarget(inv.command);
  } catch (error) {
    return { output: `CLI invocation failed: ${(error as Error).message}`, success: false };
  }

  // TODO(异步化): spawnSync 仍会阻塞事件循环；同步调用方（claude/codex
  // runner 的 run() 链路）后续应统一切到 runCliAsync。本修复只消除
  // shell:true 的命令注入面，完整异步化牵涉 runner 接口改造，超出本次范围。
  const res = spawnSync(target.file, target.args, {
    cwd: inv.cwd,
    input: inv.prompt,
    encoding: 'utf-8' as const,
    timeout: inv.timeout ?? 300_000,
    maxBuffer: 10 * 1024 * 1024,
    ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });

  if (res.error) {
    return { output: `CLI invocation failed: ${res.error.message}`, success: false };
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    return {
      output: `CLI exited with code ${res.status}: ${res.stderr || res.stdout || ''}`,
      success: false,
    };
  }
  return { output: res.stdout ?? '', success: true };
}

const MAX_CLI_OUTPUT = 10 * 1024 * 1024; // 与 spawnSync maxBuffer 对齐

function truncateOutput(value: string): string {
  return value.length > MAX_CLI_OUTPUT ? value.slice(0, MAX_CLI_OUTPUT) : value;
}

/**
 * Async variant of {@link runCli}. Same semantics (command from env/config,
 * prompt via stdin, win32 via an explicitly escaped cmd.exe command line — never
 * `shell:true`) but uses non-blocking `child_process.spawn` so a long-running CLI
 * never stalls the host event loop (used by the session collaboration
 * fire-and-forget path). Errors, non-zero exits and timeouts are folded into a
 * `CliResult` — never thrown.
 */
export function runCliAsync(inv: CliInvocation): Promise<CliResult> {
  return new Promise((resolve) => {
    let target: SpawnTarget;
    try {
      target = resolveSpawnTarget(inv.command);
    } catch (error) {
      resolve({ output: `CLI invocation failed: ${(error as Error).message}`, success: false });
      return;
    }
    const child = spawn(target.file, target.args, {
      cwd: inv.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });

    inv.onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (result: CliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // Two-stage kill: SIGTERM first, SIGKILL if it hasn't closed shortly after.
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), 3000);
      killer.unref?.();
      settle({ output: `CLI timed out after ${inv.timeout ?? 300_000}ms`, success: false });
    }, inv.timeout ?? 300_000);
    timer.unref?.();

    child.stdout.on('data', (data) => { stdout = truncateOutput(stdout + String(data)); });
    child.stderr.on('data', (data) => { stderr = truncateOutput(stderr + String(data)); });
    child.on('error', (error) => settle({ output: `CLI invocation failed: ${error.message}`, success: false }));
    child.on('close', (code, signal) => {
      // A `null` code with a signal means the host (or our timeout kill) SIGTERM'd
      // the child — that is a failure, not a clean exit.
      if (typeof code === 'number' && code !== 0) {
        settle({ output: `CLI exited with code ${code}: ${stderr || stdout || ''}`, success: false });
      } else if (signal) {
        settle({ output: `CLI terminated by signal ${signal}: ${stderr || stdout || ''}`, success: false });
      } else {
        settle({ output: stdout, success: true });
      }
    });

    // A CLI may close stdin early (e.g. claude -p mode) — EPIPE is not a failure.
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(inv.prompt);
    child.stdin.end();
  });
}
