# AGENTS

You are in `src/auth`, which owns deployment authorization, signing helpers,
and related record handling used by module distribution.

## Rules

- Keep signing and authorization flows deterministic and explicit.
- Do not invent app-local signature records when a repo-level contract belongs
  here.
- When auth changes affect transport or deployment plans, update the related
  surfaces together rather than splitting incompatible changes across repos.

## Related Surfaces

- `src/transport`
- `src/deployment`
- `test/transport-records.test.js`
- `test/deployment-plan.test.js`

## Check Before You Finish

- `npm test`
- `npm run check:compliance`
- `node --test test/transport-records.test.js test/deployment-plan.test.js`
