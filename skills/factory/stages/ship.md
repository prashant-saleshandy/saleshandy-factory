# Stage: ship

Goal: PRs, Jira updates, the test plan share and the release doc. This stage does no review and no tests. It accepts its input as fully tested. The script does the git flow. You write only the summary and the release doc.

## 1. Approval to push

1. Run `ship.mjs plan`. If a repo shows uncommitted changes, stop and tell the user.
2. Show the user the plan: branches, PR titles, and the Jira changes.
3. Run `work.mjs request-approval push`. Ask with AskUserQuestion: "Push and open PRs" or "Discuss changes".

## 2. Push and PRs

Do these steps in this order. If a step fails, stop and tell the user.

1. `ship.mjs push`
2. `ship.mjs share-test-plan`. The test plan is private, with a password. The password and the update key stay in `.factory/secrets.json`.
3. `ship.mjs staging`. If a merge conflict occurs, stop. Tell the user the repo and the files. Do not resolve it unless the user asks.
4. Write `.factory/pr-summary.md`: three to six short points about what the PRs do.
5. `ship.mjs prs --summary-file .factory/pr-summary.md`

## 3. Jira

If the work is phased, add a comment to the phase task. If not, add it to the epic. The comment gives the PR links and the test plan link. If the user notes ask for a status change, make it.

## 4. Release doc

The release doc is for prod only. It contains only the PRs to `main`, the prod SQL and the prod steps. It contains no staging references.

1. Make it again from the start in each phase. Do not append to the old version.
2. Start one `factory:release-writer` subagent with the model and effort of the `release-writer` role. Give it these pointers: the work folder, the worktree paths, the main PR links, `ROOT/templates/release-doc.md`, and the output path `.factory/release-doc.md`.
3. Read the assumptions that the release writer returns. Show them to the user with the release doc.
4. Run `work.mjs request-approval release`. Ask with AskUserQuestion: "Approve the release doc" or "Discuss changes".
5. After approval, make or update the Confluence child page `Release doc` under the parent page. Record it with `work.mjs set release.pageId <id>` and `work.mjs set release.url <url>`.

## 5. Next phase

- If the work has more phases, run `work.mjs set phase <n + 1>` and `work.mjs set stage build`.
- If this was the last phase, run `work.mjs set stage done`. Tell the user that the main PRs are drafts and that the release doc is ready.

Give the user the session advice from SKILL.md.
