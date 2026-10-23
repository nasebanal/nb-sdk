# Contributing to nb-sdk

Contributions are welcome. You do not need a NASEBANAL account, an npm token or
any other repository to build and test your change.

## Set up

```bash
git clone https://github.com/nasebanal/nb-sdk.git
cd nb-sdk
npm install
npm test            # fetches the pinned public API contracts, generates the clients, runs Vitest
npm run typecheck
```

`spec-versions.json` pins the API contract versions; codegen downloads exactly
those from `api-specs.nasebanal.com`. Everything else is a public dependency.

## What to change where

- **The runtime** (`src/client.ts`, `src/http.ts`, `src/auth.ts`, `src/errors.ts`):
  hand-written; change it here, with a test in `src/sdk.test.ts`. The SDK has no
  runtime dependencies and should stay that way.
- **The typed clients** (`src/generated/`, git-ignored): generated from the API
  contracts. Do not edit them. A missing or badly named operation is fixed in the
  contract (`nb-api-specs`), then adopted here by bumping `spec-versions.json` in
  its own PR.

## Pull requests

- One topic per PR. Title and commit messages start with `feature:`, `fix:` or
  `chore:`, in present tense (`fix: retry on 429 with Retry-After`).
- CI (`npm test`, typecheck) must pass. Codegen must stay deterministic: a second
  run is byte-identical.
- Say in the PR description how you checked the change. Calling a live API needs
  an account, so a test that uses a mocked `fetch` is what we ask for; the
  maintainers try it against the real API during review.
