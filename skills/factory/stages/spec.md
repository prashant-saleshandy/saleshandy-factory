# Stage: spec

Goal: a tech analysis that the user approves. After approval, it is the source of truth for all development. This stage is a loop: research, a draft, questions, changes, and then approval.

Method credit: the question rounds adapt the "grilling" skill by Matt Pocock (github.com/mattpocock/skills, MIT).

## 1. Start

- Read `.factory/context.md`.
- If a tech analysis page already exists on Confluence, ask the user with AskUserQuestion if the draft starts from it.

## 2. Research

Decide what to read from the scope of the work. Do not stop at one or two layers. Follow each related flow from its entry point to its end, across repos, until you know the real constraints. Typical constraints are in code paths, data models, queues, crons, other services, feature flags, plan limits and data scale. If a design decision depends on volume, read the numbers through Grafana (`grafana` for prod, `pyxis-grafana` for staging).

- Facts are your job. Decisions are the user's job. Never ask the user for a fact that you can find.
- For a big area, give one question to one `factory:researcher` subagent. Start at most `maxSubagents` at the same time.
- Each researcher writes one file `.factory/facts/<topic>.md` and returns a short summary.
- Keep `.factory/facts.md` as an index: one line for each topic file, with what it answers.

A fact line has this form: `F7. <fact>. Source: edge/src/x/y.service.ts:120`.

## 3. Draft

1. Copy `ROOT/templates/spec.html` to `.factory/spec.html` and fill it.
2. Give each requirement an ID (R1, R2, ...) and acceptance criteria. Later stages refer only to these IDs. Never reuse the ID of a removed requirement.
3. Decide the mode. If the work is too big for one safe release to staging, propose phases. Each phase must be shippable and testable on staging alone. Record the decision with `work.mjs set mode phased` and `work.mjs set phases <n>`.
4. Load the lavish skill, open the draft with `npx -y lavish-axi .factory/spec.html`, and wait for annotations as that skill says.

## 4. Question rounds

- Keep a design tree: each decision branches into the decisions that depend on it.
- The frontier is each open decision whose prerequisites are settled. Ask the full frontier in one round. Number the questions. Give your recommended answer for each, so that "yes" accepts it.
- If a question depends on another open question in the same round, move it to a later round.
- If a question needs a fact, start a researcher for that fact. Ask the other questions without a wait.
- After each round, update `spec.html`. Put each answer in the correct section and remove the resolved question.
- If the frontier is empty and the user says that the understanding is shared, the rounds end.

## 5. Approval

1. Run `work.mjs request-approval spec`.
2. Ask with AskUserQuestion. Use the options "Approve the spec" and "Discuss changes". If the user selects "Discuss changes", go back to step 4.
3. A hook records the approval. Run `work.mjs gate` to see the result.

## 6. After approval

1. List the spaces with `getConfluenceSpaces`. Ask the user with AskUserQuestion to select the space. Also ask for the parent page of this work, with "None" as an option.
2. Write the spec as Confluence markdown to `.factory/tmp-spec.md`. Keep the requirement IDs, tables, SQL and citations.
3. Make the parent page `<KEY> - <title>` (if it does not exist) and the child page `Tech analysis` with `createConfluencePage`. Use the content of `.factory/tmp-spec.md`.
4. Run `work.mjs spec-published --page-id <id> --url <url> --version <n> --space <key> --parent-id <parent id>`.
5. Run `work.mjs set confluence.parentId <parent id>` and `work.mjs set confluence.parentUrl <url>`.
6. Run `work.mjs spec-cache --version <n> --from .factory/tmp-spec.md`.
7. Make the Jira structure under the epic. If the work is phased, make one task `[PHASE - 01] - <title>` for each phase and one subtask for each work item. If not, make one task for each work item. Link the Confluence parent page to the epic.
8. Ask with AskUserQuestion: "Delete the draft" or "Keep the draft". If the user keeps it, add this line at the top of `spec.html`: `<div class="banner">Superseded by Confluence vN: link</div>`.
9. Run `work.mjs set stage build` and `work.mjs set phase 1`. Give the user the session advice from SKILL.md.

## Spec change

If the spec must change after approval, do these steps:

1. Change the Confluence page with `updateConfluencePage`. Keep the old requirement IDs.
2. Write the new page body to `.factory/tmp-spec.md` and run `work.mjs spec-cache --version <new n> --from .factory/tmp-spec.md`. The new version closes the gate.
3. Show the user the changed requirements in a short list, then ask for approval as in step 5.
4. After approval, update the affected Jira tasks.
