export interface ParsedRunOutput {
  summary: string;
  changedFiles?: string[];
  issues?: string[];
}

export function parseRunOutput(output: string): ParsedRunOutput {
  const lines = output.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

  const summary = lines.length > 0 ? lines[0]! : '';
  const changedFiles = extractChangedFiles(output);
  const issues = extractIssues(output);

  return {
    summary,
    changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
    issues: issues.length > 0 ? issues : undefined,
  };
}

export function extractChangedFiles(output: string): string[] {
  const files: string[] = [];

  // Look for common file path patterns
  const patterns = [
    /(?:modified|created|deleted|changed):\s*([^\s]+(?:\.[a-z]+)+)/gi,
    /(?:file|path):\s*([^\s]+(?:\.[a-z]+)+)/gi,
    /- ([^\s]+(?:\.(?:ts|js|tsx|jsx|json|md|py|go|rs|java|rb|php|css|html|vue|svelte))+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const filePath = match[1];
      if (filePath && !files.includes(filePath)) {
        files.push(filePath);
      }
    }
  }

  return files;
}

function extractIssues(output: string): string[] {
  const issues: string[] = [];

  // Look for common issue patterns
  const patterns = [
    /(?:issue|problem|error|warning|bug|fix):\s*(.+)/gi,
    /- (?:issue|problem|error|warning|bug|fix):?\s*(.+)/gi,
    /\[(?:error|warning|issue)\]\s*(.+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const issue = match[1]?.trim();
      if (issue && !issues.includes(issue)) {
        issues.push(issue);
      }
    }
  }

  return issues;
}
