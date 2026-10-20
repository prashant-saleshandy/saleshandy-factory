# Stage: build

Goal: code in the worktrees that does exactly what the approved spec says for the current phase. You are the orchestrator. You divide the work, give tasks to subagents, and supervise them.

Method credit: the task graph and the context pointers adapt the "implement-spec" skill by Matt Pocock (github.com/mattpocock/skills, MIT).

## 1. Start

1. Run `work.mjs gate`. If code edits are blocked, stop and tell the user why.
2. Read the requirements of the current phase in `.factory/spec.cache.md`.
3. Read `.factory/facts.md` and only the topic files that the phase needs.
4. Read `ROOT/skills/factory/lenses.md` one time.
5. For each repo, read the `scripts` of its `package.json`. If `~/.claude/factory/profiles/<repo>.md` exists, read it too.

## 2. Plan

Write `.factory/build-plan.md`. Each task gets one line: ID, repo, requirement IDs, files, "depends on", status.

- Order the tasks as a graph. If the dependencies of a task are done, the task can start.
- If two tasks change the same file, one task depends on the other.
- If a task is small, do it yourself. A subagent costs more tokens than a small edit.

## 3. Subagents

- Start the minimum number of `factory:implementer` subagents. Start at most `maxSubagents` at the same time.
- Give each implementer one repo worktree. Two implementers never work in the same repo at the same time.
- Give pointers, not content: the worktree path, the task IDs, the requirement IDs, the fact files, and the paths of `spec.cache.md` and `lenses.md`.
- If an implementer reports a problem with the spec, stop all work and tell the user.

## 4. Decision criteria

Each decision, yours or a subagent's, obeys these criteria in this order:

1. Alignment with the spec.
2. Security.
3. Maintainability.
4. UI and UX.
5. The conventions of the repo and its stack, as the code around the change shows them.

If the code cannot do what the spec says, stop and tell the user. Change the spec first (see "Spec change" in `stages/spec.md`), then change the code.

## 5. Commits

- Commit on the work branch in each worktree. Message form: `<type>(<KEY>): <short summary>`.
- If a commit hook fails, correct the cause. Do not skip hooks.

## 6. Data changes

If the phase changes a TypeORM entity, print the incremental SQL for staging in the chat, in a `sql` code block. Tell the user that someone must operate it on staging. Never put the SQL in a file in a repo.

If a release step cannot show in a diff, add one line to `.factory/release-notes.md`. Examples are a data backfill, a manual configuration change, or an order constraint between deploys.

## 7. End

Update the statuses in `build-plan.md`. Run `work.mjs set stage review`. Give the user the session advice from SKILL.md.
