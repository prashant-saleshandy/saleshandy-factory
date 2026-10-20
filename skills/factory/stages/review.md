# Stage: review

Goal: the code and the spec agree one to one. The reviewer reports. It fixes nothing.

## 1. Review

Start `factory:reviewer` subagents, one for each repo, at most `maxSubagents` at the same time. A reviewer has a new context, so it does not share the assumptions of the builder. Give each reviewer these pointers:

- the worktree path and the diff command `git -C <path> diff origin/main...HEAD`,
- `.factory/spec.cache.md` and the requirement IDs of the current phase,
- `.factory/facts.md`,
- `ROOT/skills/factory/lenses.md`.

Each reviewer writes its section of `.factory/review.md` and returns a short summary.

## 2. Report

`review.md` has three lists for each repo:

1. Missing: requirement IDs with no code, or with code that does not meet the acceptance criteria.
2. Extra: code that no requirement asks for.
3. Lens findings: security, UX, UI and code problems, each with `path:line` and a severity (high, medium, low).

## 3. Decisions

Show the user a short summary of the report. Do not fix drift automatically, because a drift can be an intentional change that the spec does not show yet.

- For each drift item (missing or extra), ask with AskUserQuestion: "Fix the code" or "Update the spec".
- For each high or medium lens finding, ask: "Fix it" or "Ignore it". Group low findings into one question.
- If the user selects "Update the spec", follow "Spec change" in `stages/spec.md`.
- If the user selects a fix, go to the build stage for these items only. Then review only the changed diff.

## 4. End

If no drift remains, run `work.mjs set stage test` and give the user the session advice from SKILL.md.
