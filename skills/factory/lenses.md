# Lenses

The builder obeys these checklists. The reviewer reports each miss with `path:line` and a severity.

## Security

- Each new endpoint has authentication and the correct authorization. A user can read and change only the data of their own account or team.
- The code makes sure that all input from users, webhooks and queues is correct at the boundary.
- SQL uses parameters. No string concatenation builds a query.
- No secret, token or personal data goes into logs, errors, URLs or the frontend bundle.
- New external calls have a timeout, and their failure does not stop unrelated work.
- Rate limits and plan limits apply to the new paths, the same as to the old paths.

## UX

- Each new flow covers the empty state, the loading state, the error state and the success state.
- Error messages tell the user what happened and what to do next.
- Before a destructive action, the UI asks the user to agree.
- Long operations show progress, or they run in the background with a clear result.

## UI

- The change uses the existing components, tokens and spacing of the repo. It adds no new style system.
- The layout works at the smallest supported width.
- Interactive elements work with the keyboard and have accessible names.
- Text fits in its container in the longest expected language string.

## Code

- The change follows the patterns of the code around it: module structure, naming, error handling, logging.
- No duplicate of an existing helper, service or query.
- Database access is efficient at the real data scale: indexes exist for new filters, and no query runs in a loop.
- Queue jobs and crons are idempotent (safe to do two times) and can retry.
- No dead code, no commented-out code, and no debug output.
- Tests follow the existing test style of the repo.
