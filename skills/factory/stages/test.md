# Stage: test

Goal: each acceptance criterion of the current phase passes. The tester plans its own tests. Your notes in `~/.claude/factory/notes/tester.md` change how it plans.

## 1. Plan

1. Read `.factory/spec.cache.md`, `.factory/review.md` and `.factory/build-plan.md`.
2. If `.factory/test-plan.html` does not exist, copy `ROOT/templates/test-plan.html` to it.
3. Add a section for the current phase. Add one item for each thing to test. Each item names its requirement IDs and how you test it.
4. Change only the JSON block in `test-plan.html`. The page shows the JSON.
5. Open the plan with lavish so the user can see it: `npx -y lavish-axi .factory/test-plan.html`.

## 2. Credentials and data

- Ask the user which credentials the tests need. Make `.factory/.env` with empty keys and tell the user to fill it. Never print the values.
- For staging data, use the `pyxis-grafana` MCP. For prod data, use the `grafana` MCP. Both are read-only. Choose the source that the test needs.
- If the user asks for UI automation, do it. If not, do not start it.

## 3. Do the tests

- Do the items one at a time. After each item, set its `status` to `pass` or `fail` in the JSON. A failed item gets a short `note` with the cause.
- If an item fails, collect it. When a group of items is done, give the failed items to the build stage. Then review only the changed diff. Then do only the failed items again.

## 4. Final checks

In each repo worktree, operate the lint, typecheck and build scripts from `package.json`. If a script fails, give the cause to the build stage, then operate the script again.

## 5. End

If all items pass and the scripts pass, run `work.mjs set stage ship`. Give the user the session advice from SKILL.md.
