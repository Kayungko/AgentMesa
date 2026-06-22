export interface SkillOptions {
  outputDir: string;
}

export interface SkillFile {
  path: string;
  content: string;
}

function buildMeetSkill(): SkillFile {
  return {
    path: 'agentmesa-meet.md',
    content: [
      '# agentmesa-meet',
      '',
      'Create a meeting for a task to coordinate multi-agent collaboration.',
      '',
      '## Instructions',
      '',
      '1. Call `mesa_create_meeting` with a descriptive `title`, the relevant task ids',
      '   in `tasks`, and the participating agent ids in `agents`.',
      '2. Call `mesa_post_message` with `type: "handoff"` to notify participants.',
      '3. Report the meeting ID back to the user.',
      '',
    ].join('\n'),
  };
}

function buildHandoffSkill(): SkillFile {
  return {
    path: 'agentmesa-handoff.md',
    content: [
      '# agentmesa-handoff',
      '',
      'Hand off a completed run to a reviewer through the AgentMesa handoff loop.',
      '',
      '## Instructions',
      '',
      '1. Ensure the work is captured: the run produced an `agent_run_log` (or you',
      '   attached an `implementation_summary`) via `mesa_attach_artifact`.',
      '2. Call `mesa_request_handoff` with the `taskId`, the `runId`, the `artifactId`',
      '   to review, the `requestedReviewer`, and a `summary` of the current state.',
      '3. The reviewer replies with `mesa_submit_handoff_result` (`verdict`',
      '   `approved` or `changes_requested`). Poll with `mesa_list_handoffs`.',
      '4. Confirm the handoff to the user.',
      '',
    ].join('\n'),
  };
}

function buildFixFromReviewSkill(): SkillFile {
  return {
    path: 'agentmesa-fix-from-review.md',
    content: [
      '# agentmesa-fix-from-review',
      '',
      'Fix issues identified in a review report and re-request review.',
      '',
      '## Instructions',
      '',
      '1. Call `mesa_list_artifacts` with the task ID and read the latest',
      '   `review_report` artifact.',
      '2. Implement all requested fixes.',
      '3. Call `mesa_update_status` with `status: "ready_for_review"` when done.',
      '4. Call `mesa_attach_artifact` with `kind: "fix_summary"` describing each fix.',
      '5. Call `mesa_post_message` with `type: "fix_done"` to notify the reviewer.',
      '',
    ].join('\n'),
  };
}

function buildStatusSkill(): SkillFile {
  return {
    path: 'agentmesa-status.md',
    content: [
      '# agentmesa-status',
      '',
      'Check and update the status of a task.',
      '',
      '## Instructions',
      '',
      '1. Call `mesa_read_task` to retrieve the current task details.',
      '2. Display the task ID, title, status, assignee, and reviewer.',
      '3. If a new status is requested, call `mesa_update_status` with the new status.',
      '4. Call `mesa_post_message` with `type: "status_changed"` to record the transition.',
      '',
    ].join('\n'),
  };
}

function buildRunSkill(): SkillFile {
  return {
    path: 'agentmesa-run.md',
    content: [
      '# agentmesa-run',
      '',
      'Create and execute an agent run for a task, then report the produced output.',
      '',
      '## Instructions',
      '',
      '1. Call `mesa_create_run` with the `agentId`, the `input` prompt, and the',
      '   `taskId`. The run starts in `pending`.',
      '2. Call `mesa_exec_run` with the `runId` to drive it',
      '   `pending → running → completed | failed`. When the runner env vars are set',
      '   this spawns the real local CLI; otherwise it uses the prompt-echo stub.',
      '3. On success the run produces an `agent_run_log` artifact — report the run',
      '   status and `producedArtifactIds` back to the user.',
      '4. If the run `failed`, surface the error and stop.',
      '',
    ].join('\n'),
  };
}

function buildReviewSkill(): SkillFile {
  return {
    path: 'agentmesa-review.md',
    content: [
      '# agentmesa-review',
      '',
      'Review a task implementation and submit a verdict.',
      '',
      '## Instructions',
      '',
      '1. Call `mesa_list_tasks` filtered to `status: "ready_for_review"`. If none,',
      '   report "No tasks ready for review" and stop. Pick the first task.',
      '2. Call `mesa_read_task` for the full task context.',
      '3. Call `mesa_list_artifacts` for the task and read the `implementation_summary`',
      '   and any `git_diff` artifact.',
      '4. Analyze for correctness, code quality, tests, edge cases, and security.',
      '5. Call `mesa_submit_review` with the task ID, a `verdict` of `approved` or',
      '   `changes_requested`, and a summary of findings.',
      '6. Call `mesa_attach_artifact` with `kind: "review_report"` and the full report.',
      '',
      '## Rules',
      '',
      '- Do NOT modify source code during review.',
      '- Do NOT approve without reading the diff.',
      '- Be specific: reference file names and what needs to change.',
      '',
    ].join('\n'),
  };
}

export function generateSkillFiles(options: SkillOptions): SkillFile[] {
  const { outputDir } = options;

  const skills = [
    buildMeetSkill(),
    buildHandoffSkill(),
    buildFixFromReviewSkill(),
    buildStatusSkill(),
    buildRunSkill(),
    buildReviewSkill(),
  ];

  return skills.map((skill) => ({
    path: `${outputDir}/${skill.path}`,
    content: skill.content,
  }));
}
