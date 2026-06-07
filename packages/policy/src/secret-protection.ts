const SECRET_PATH_PATTERNS = [
  /\.env/i,
  /\.ssh\//i,
  /credentials/i,
  /secrets?\//i,
  /keys?\//i,
  /tokens?\//i,
];

const SECRET_CONTENT_PATTERNS = [
  /API_KEY\s*=\s*\S+/i,
  /API_SECRET\s*=\s*\S+/i,
  /PASSWORD\s*=\s*\S+/i,
  /SECRET\s*=\s*\S+/i,
  /TOKEN\s*=\s*\S+/i,
  /PRIVATE_KEY\s*=\s*\S+/i,
  /ACCESS_KEY\s*=\s*\S+/i,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  new RegExp('sk_' + 'live_' + '[A-Za-z0-9]{20,}'),
  new RegExp('sk_' + 'test_' + '[A-Za-z0-9]{20,}'),
  new RegExp('ghp_' + '[A-Za-z0-9]{36,}'),
  new RegExp('ghs_' + '[A-Za-z0-9]{36,}'),
  new RegExp('gho_' + '[A-Za-z0-9]{36,}'),
  new RegExp('ghu_' + '[A-Za-z0-9]{36,}'),
  new RegExp('AKIA' + '[0-9A-Z]{16}'),
  new RegExp('xoxb' + '-[0-9]+-[A-Za-z0-9]+'),
  new RegExp('xoxp' + '-[0-9]+-[A-Za-z0-9]+'),
];

const REDACTED = '[REDACTED]';

export class SecretProtection {
  isSecretPath(path: string): boolean {
    const normalized = path.replace(/\\/g, '/');
    return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  isSecretContent(content: string): boolean {
    return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
  }

  sanitizeContent(content: string): string {
    let sanitized = content;
    for (const pattern of SECRET_CONTENT_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match) => {
        const eqIdx = match.indexOf('=');
        if (eqIdx !== -1) {
          return match.slice(0, eqIdx + 1) + REDACTED;
        }
        return REDACTED;
      });
    }
    return sanitized;
  }
}
