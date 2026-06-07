/**
 * Options for generating the review skill definition.
 */
export interface ReviewSkillOptions {
  /** Path to the AgentMesa workspace directory. */
  mesaDir?: string;
}

/**
 * A review skill definition for Codex CLI.
 */
export interface ReviewSkillDefinition {
  name: string;
  description: string;
  instructions: string;
}

/**
 * Generates a review skill definition that Codex can use
 * to perform structured task reviews using AgentMesa MCP tools.
 */
export function generateReviewSkill(options: ReviewSkillOptions = {}): ReviewSkillDefinition {
  const { mesaDir = '.mesa' } = options;

  const instructions = [
    'You are performing a code review for an AgentMesa task.',
    'Follow these steps exactly:',
    '',
    `**Workspace directory:** \`${mesaDir}\``,
    '',
    '## Step 1: Find tasks ready for review',
    '',
    'Call `mesa_list_tasks` with filter `status=ready_for_review`.',
    'If no tasks are found, report "No tasks ready for review" and stop.',
    'Pick the first task from the list.',
    '',
    '## Step 2: Read the task details',
    '',
    'Call `mesa_read_task` with the task ID to get the full task context',
    'including goal, changed files, and any constraints.',
    '',
    '## Step 3: Retrieve the implementation summary',
    '',
    'Call `mesa_list_artifacts` with the task ID and filter for kind `implementation_summary`.',
    'Read the summary to understand what was implemented and why.',
    '',
    '## Step 4: Get the git diff',
    '',
    'Call `mesa_list_artifacts` with the task ID and filter for kind `git_diff`.',
    'If a diff artifact exists, read it. Otherwise, check the changed files directly.',
    '',
    '## Step 5: Produce review findings',
    '',
    'Analyze the diff and implementation for:',
    '- Correctness: Does the implementation match the goal?',
    '- Code quality: Is the code clean, readable, and maintainable?',
    '- Tests: Are there adequate tests for the changes?',
    '- Edge cases: Are edge cases handled?',
    '- Security: Any obvious security concerns?',
    '',
    '## Step 6: Submit the review verdict',
    '',
    'Call `mesa_submit_review` with:',
    '- The task ID',
    '- Verdict: `approved` if the implementation is good, `changes_requested` if issues found',
    '- A summary of your findings',
    '',
    '## Step 7: Attach the review report',
    '',
    'Call `mesa_attach_artifact` with:',
    '- Kind: `review_report`',
    '- Content: The full structured review report in markdown format',
    '- The task ID',
    '',
    '## Important rules',
    '',
    '- Do NOT modify any source code during review.',
    '- Do NOT approve without reading the diff.',
    '- Be specific about issues: reference file names and line numbers.',
    '- If changes are requested, clearly describe what needs to be fixed.',
  ].join('\n');

  return {
    name: 'agentmesa-review',
    description: 'Review an AgentMesa task implementation',
    instructions,
  };
}
