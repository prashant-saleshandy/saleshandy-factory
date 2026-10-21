# Batch mode

Goal: a list of small fixes and investigations, each with its own ticket, worktree, branches and PRs. No epic, no phases, no Confluence page and no release doc.

The batch lives in `<workspace>/worktrees/.batches/<id>/`. It holds `batch.json`, the shared `test-plan.html`, `reports/` and `secrets.json`. Each fix lives in `<workspace>/worktrees/<KEY>/`, as in the normal mode. In this file, `<b>` means `--batch <id> --workspace <workspace>`.

## 1. Start

1. Run `work.mjs batch-init --workspace <workspace> --session <session id>`. To continue a batch, run `work.mjs attach --session <session id> <b>`.
2. Run `work.mjs models`. The batch main session uses the `batch` values.

## 2. Triage

Sort each line of the request into a fix or an investigation. A fix has a clear error and a code cause. An investigation starts from a symptom, for example "service X went down" or "a spike in errors".

- If a line has a ticket, read it with `getJiraIssue`.
- If a line has no ticket, find evidence first. For an error, find it in Loki and in the code. For a symptom, start a `factory:investigator` subagent (see step 4). Then draft a ticket: title, repo, error, repro steps, evidence and probable cause.
- For each new ticket, find a similar ticket in the same repo with `searchJiraIssuesUsingJql`. Copy its project, issue type, components and labels. Set the user as the assignee.
- Show all draft tickets together. Ask with AskUserQuestion: "Make the tickets" or "Change something". After the user agrees, make them with `createJiraIssue`.
- Add each item: `work.mjs batch-add <KEY> --kind fix|investigation --title "<t>" --url <jira url> <b>`. A fix gets its work folder from this command.

## 3. Fix notes

For each fix:

1. Add the worktree: `work.mjs add-repo <repo> --work <workspace>/worktrees/<KEY>`.
2. Find the root cause in the code. Read only what the cause needs.
3. Write `.factory/fix-note.md` in the work folder, in this form:

```
# <KEY> - <title>
Cause: <one or two sentences>. Evidence: <path:line, log query>
Change: <what changes, in which files>
Acceptance criteria:
- <criterion>
Risk: <what else this can affect>
```

Then approve all notes together:

1. Run `work.mjs request-approval fixnote --keys <K1,K2,...> <b>`. The script prints the questions.
2. Ask with AskUserQuestion, with `multiSelect: true`, in the groups that the script prints. Each group has the labels "Approve <KEY>" and "Discuss changes".
3. A hook records each selected approval. Run `work.mjs batch-status <b>` to see the result.
4. For each approved note, add the note to the Jira ticket with `addCommentToJiraIssue`. The Jira comment is the source of truth for that fix.
5. For each note that needs changes, change it and ask again for that note only.

If a note changes after approval, the code gate of that fix closes. Add the new note to Jira and ask for approval again.

## 4. Investigations

1. Start one `factory:investigator` subagent for each investigation, with the model and effort of the `investigator` role. Start at most `maxSubagents` at the same time. Give it the symptom, the time range, the repos and the output file `reports/<KEY>.md` in the batch folder.
2. Add the report to the Jira ticket with `addCommentToJiraIssue`. Write counts, times and error types, never customer data. Then run `work.mjs batch-set <KEY> jiraComment true <b>`.
3. Ask the user with AskUserQuestion what to do with each finding: "Fix it in this batch", "Make a ticket for later", or "No action".
4. If the user selects "Fix it in this batch", run `work.mjs batch-add <KEY> --kind fix <b>` and go to step 3 for that item.
5. Record the end state with `work.mjs batch-set <KEY> stage done <b>`, or `stage later`.

## 5. Build, review, test

Follow `stages/build.md`, `stages/review.md` and `stages/test.md`, with these differences:

- The fix note replaces the spec. The acceptance criteria in the note replace the requirement IDs.
- Build: give each fix to one implementer subagent with the correct role. If a fix is very small, do it yourself. Set the stage of each fix with `work.mjs set stage <name> --work <work folder>`.
- Review: one `factory:reviewer` subagent can read the diffs of all fixes. It compares each diff with its fix note. Drift goes to the user, as in the normal mode.
- Test: write one test plan for the batch in `<batch folder>/test-plan.html`, with one section for each fix. Test the error path and the paths around it.

## 6. Ship

1. Run `ship.mjs plan --work <work folder>` for each fix. Show the user one combined plan.
2. Run `work.mjs request-approval push --keys <K1,K2,...> <b>`. Ask with AskUserQuestion, `multiSelect: true`, with the labels "Push <KEY>" and "Discuss changes".
3. For each approved fix, in this order: `ship.mjs push`, `ship.mjs share-test-plan` (one time for the batch), `ship.mjs staging`, and `ship.mjs prs --summary-file <file>`. Use `--work <work folder>` on each command.
4. If a merge conflict occurs, stop and tell the user. Do not resolve it unless the user asks.
5. Add a comment to each ticket with the PR links and the test plan link.
6. If a fix needs SQL or a manual step at release, add these steps to the ticket as a Jira comment. Print the SQL in the chat too.
7. Run `work.mjs set stage done --work <work folder>` for each shipped fix. Show the board with `work.mjs batch-status <b>`.
