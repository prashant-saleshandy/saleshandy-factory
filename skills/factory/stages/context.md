# Stage: context

Goal: turn unstructured input into `.factory/context.md`, a short and scoped starting point for the spec. Later sessions read this file and do not read the sources again.

## 1. Collect the input

- Read the request. It can hold a ticket key, an epic link, pasted Basecamp text, PRD links or notes.
- Read the Jira ticket and its epic with the Atlassian MCP (`getJiraIssue`). If the child issues of the epic change the scope, read them too.
- If the ticket refers to Confluence pages, read them with `getConfluencePage`. If a tech analysis page already exists, record its page ID and version.
- No tool reads Basecamp. If the ticket refers to a Basecamp thread and the user did not paste it, ask the user to paste only the important parts.
- Read only what changes the scope. If you know the goal, the requirements and the constraints, stop.

## 2. Find the state of the work

Run `work.mjs detect <KEY> --workspace <workspace>` for the ticket key and for the epic key. Then decide:

- Ongoing work: an epic, branches or a work folder exist. Use them. Take the type (feat or fix) from the branch prefix.
- New work: nothing exists. Tell the user what you will make: the epic (if the ticket has no epic), the work folder, the branch names and the repos. Ask with AskUserQuestion, with the options "Make it" and "Change something".
- Mixed signals, for example branches on a different key, or two epics: ask the user with AskUserQuestion. Offer the choices that you found, a new epic, and other branch names.

If an epic exists, the KEY for the work folder and all branches is the epic key. If you make a new epic, make it with the Atlassian MCP after the user agrees.

## 3. Make the work folder

1. `work.mjs init <KEY> --workspace <ws> --type feat|fix --title "<short title>" --epic <KEY>`
2. `work.mjs attach --session <id> --work <ws>/worktrees/<KEY>`
3. `work.mjs add-repo <repo> --work <...>` for each repo that is clearly in scope. You can add a repo later.

## 4. Write the handoff

Write `.factory/context.md`. Use at most 150 lines. Write facts, not design.

```
# <KEY> - <title>
## Goal            (two or three sentences)
## Sources         (links: ticket, epic, pages, PRDs)
## Requirements    (as stated, each with its source)
## Constraints     (deadlines, plans, limits, compatibility)
## Decisions made  (with who decided and where)
## Unknowns        (questions for the spec stage)
## Repos in scope  (each with one line about why)
```

Then run `work.mjs set stage spec` and give the user the session advice from SKILL.md.

If the requirements change later, the user asks you to update `context.md`. Update only the changed lines.
