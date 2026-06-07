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
      '1. Call `mesa_meeting_create` with a descriptive title and the relevant task ID.',
      '2. Call `mesa_meeting_add_agent` for each agent that should participate.',
      '3. Call `mesa_message_create` with `type: "handoff"` to notify participants.',
      '4. Report the meeting ID back to the user.',
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
      'Hand off a task to another agent for the next phase of work.',
      '',
      '## Instructions',
      '',
      '1. Call `mesa_task_update` to set the task `assignedTo` to the target agent.',
      '2. Call `mesa_message_create` with `type: "handoff"` and a summary of current state.',
      '3. Call `mesa_artifact_create` with `kind: "implementation_summary"` if there are changes to describe.',
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
      '1. Call `mesa_artifact_read` to retrieve the review report for the current task.',
      '2. Implement all requested fixes.',
      '3. Call `mesa_task_update` with `status: "ready_for_review"` when done.',
      '4. Call `mesa_artifact_create` with `kind: "fix_summary"` describing each fix.',
      '5. Call `mesa_message_create` with `type: "fix_done"` to notify the reviewer.',
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
      '1. Call `mesa_task_get` to retrieve the current task details.',
      '2. Display the task ID, title, status, assignee, and reviewer.',
      '3. If a new status is requested, call `mesa_task_update` with the new status.',
      '4. Call `mesa_message_create` with `type: "status_changed"` to record the transition.',
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
  ];

  return skills.map((skill) => ({
    path: `${outputDir}/${skill.path}`,
    content: skill.content,
  }));
}
