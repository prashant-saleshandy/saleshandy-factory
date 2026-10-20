---
name: factory
description: Saleshandy factory. It moves a big feature or fix from a Jira ticket to PRs and a release doc. Humans approve each gate.
disable-model-invocation: true
argument-hint: "<ticket, epic link or instruction>"
---

# Factory

Request: $ARGUMENTS

## Paths

ROOT is the plugin root: two folders above the "Base directory for this skill" line.

- `node ROOT/scripts/work.mjs` manages the work folder and the state. Run it with no arguments for help.
- `node ROOT/scripts/ship.mjs` does the git flow, the PRs and the shares.
- `ROOT/templates/` holds the spec, test plan, PR and release doc templates.
- `ROOT/skills/factory/stages/<stage>.md` holds the instructions for one stage. Read only the file of the current stage.
- `ROOT/skills/factory/lenses.md` holds the security, UX, UI and code checklists.

The workspace is the folder that holds the Saleshandy repos and `worktrees/`. Each work has a folder `<workspace>/worktrees/<KEY>/`, where KEY is the epic key, for example SH-123456. In this file, `.factory/` means `<workspace>/worktrees/<KEY>/.factory/`.

## Start

1. Find the factory session id in the context ("Factory session id: ...").
2. Find the workspace. It is the current directory or its nearest parent that contains `worktrees/`. If you cannot find it, ask the user.
3. If the request names a work that has `worktrees/<KEY>/.factory/state.json`, do these steps:
   1. Run `work.mjs attach --session <id> --work <work folder>`.
   2. Run `work.mjs status --work <work folder>`.
   3. Continue at the stage in the state.
4. If no work folder exists, start the `context` stage.

## Stage order

`context` → `spec` → for each phase: `build` → `review` → `test` → `ship`.

Record each stage change with `work.mjs set stage <name>`. At the end of each stage, tell the user in one sentence that a new session costs fewer tokens: they type `/clear`, and the factory continues from the state. In the same message, give the model line that `work.mjs set stage` prints. If the user continues in this session, continue. The short loops (test → build → review → test) stay in one session.

## Models

Run `work.mjs models` one time at the start of a stage.

- The main session runs on the model that the user selects. If the session model is not the model for the stage, tell the user in one sentence which `/model` and `/effort` to type. Then continue.
- For each factory subagent, pass `model` and `effort` in the Agent call, with the values of its role. A hook blocks other values.

## Rules for all stages

- Stops for a human: spec approval, each drift, each merge conflict, the push, and the release doc approval. For an approval, run `work.mjs request-approval <kind>` and then ask with AskUserQuestion, with the exact option label that the script prints and a second option "Discuss changes". A typed message is never an approval.
- The Confluence tech analysis is the source of truth after approval. If the code cannot do what the spec says, stop and tell the user. Change the spec first (see "Spec change" in `stages/spec.md`), then change the code.
- Subagents: use the minimum number. A hook blocks more than `maxSubagents` (default 3) at the same time. Give a subagent pointers (file paths, requirement IDs, a question), not pasted content. A subagent returns conclusions with `path:line` citations, not file contents. A subagent never starts another subagent.
- Tokens: read the handoff files in `.factory/`, not the original sources again. Use the scripts for all deterministic work. Keep handoff files short. Never print a large file into the chat.
- Git: no rebase, no force push, no edits on staging branches. If a merge has a conflict, stop and tell the user. Do not resolve a conflict unless the user asks. Hooks enforce these rules.
- Personal notes: if `~/.claude/factory/notes/<stage>.md` exists, read it at the start of the stage and obey it. If the user corrects a stage in the same way two times, ask with AskUserQuestion: "Keep this as a rule for the <stage>?" If the user agrees, add one short line to that file.
- Raw SQL: print it in the chat in a `sql` code block. Never put it in a file in a repo.
- Secrets: never print the values in `.factory/secrets.json` or `.factory/.env` unless the user asks.
- Text for humans (spec, release doc, PR text, Jira comments): short, plain sentences.
