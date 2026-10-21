# Saleshandy factory

The factory is a Claude Code plugin. It moves a big feature or fix from a Jira ticket to an approved spec, code, review, tests, PRs and a prod release doc. A human approves each gate.

## Install

Install the plugin at user scope. The org repos do not change.

```
claude plugin marketplace add prashant-saleshandy/saleshandy-factory
claude plugin install factory@saleshandy-factory
```

To test a local copy, start Claude Code with the plugin folder:

```
claude --plugin-dir /path/to/saleshandy-factory
```

The factory needs Node 20 or later, `git`, `gh` (logged in), the Atlassian MCP, and the lavish skill.

## Use

Start the factory in the folder that holds the Saleshandy repos:

```
/factory SH-123456 <what to do>
```

The factory makes `worktrees/<KEY>/` with one git worktree for each repo and a `.factory/` folder for the state. To continue a work in a new session, type `/factory SH-123456`. After `/clear`, the factory continues by itself.

## Stages

| Stage | Output | Stops for you |
|---|---|---|
| context | `.factory/context.md` | New or unclear work |
| spec | Lavish draft, then Confluence tech analysis, Jira tasks | Spec approval |
| build | Commits on the work branch | Spec problems |
| review | `.factory/review.md` | Each drift |
| test | `.factory/test-plan.html` | Credentials |
| ship | Pushed branches, PRs, test plan share, release doc | Push, merge conflicts, release doc |

## Batch mode

If you give `/factory` a list of small fixes or symptoms, the factory uses batch mode.

```
/factory
edge | Cannot read property 'split' of null      SH-20314
check why reply tracker went down recently
```

- Triage reads each ticket, or drafts a new ticket from the evidence. You approve the new tickets together.
- Each fix gets a fix note, its own worktree, branches and PRs. You approve several fix notes in one question. The fix note goes to the Jira ticket as a comment.
- Each investigation gets a findings report from a read-only investigator subagent. The report goes to Jira as a comment, and you decide what to do next.
- One test plan covers the batch. No epic, no phases, no Confluence page and no release doc.
- The batch lives in `worktrees/.batches/<id>/`. `work.mjs batch-status` shows the board.

## Personal configuration

Your files are in `~/.claude/factory/`. They are not in this repo.

- `config.json` holds `maxSubagents` (default 3), `contextLimitTokens` (default 100000), and the model and effort for each stage (`stages`) and each subagent role (`agents`).
- Only you can change the model of the main session, with `/model` and `/effort`. The factory tells you the values for each stage. A hook blocks a factory subagent call with a model or effort that `agents` does not give.
- `notes/<stage>.md` holds your rules for a stage, in plain words. The agent proposes a new rule after you correct a stage in the same way two times.
- `profiles/<repo>.md` holds temporary notes about a repo.

## Hooks

| Event | Rule |
|---|---|
| SessionStart | Loads the state of the work into a factory session, also after `/clear`. |
| UserPromptSubmit | If the prompt starts with `/factory`, marks the session as a factory session. |
| PreToolUse on Edit and Write | Blocks code edits until the current spec version has an approval. Blocks edits to state files and staging worktrees. |
| PreToolUse on Bash | Blocks rebase, force push, a raw push or PR command, and changes to staging worktrees. |
| PreToolUse on Agent | Blocks more than `maxSubagents` subagents at the same time, and a factory subagent with the wrong model or effort. |
| PostToolUse on AskUserQuestion | If you select an approval option, records the approval. One answer can approve several batch items. No other answer counts. |
| Stop | If the context passes `contextLimitTokens`, tells the agent to write the handoff. |

Outside a factory session, the hooks do nothing, except in a work folder under `worktrees/`.

## Credits

The question rounds in the spec stage and the task graph in the build stage adapt methods from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
