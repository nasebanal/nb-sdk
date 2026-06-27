# NASEBANAL SDK

`@nasebanal/sdk` — a TypeScript SDK for the NASEBANAL APIs.

The client surface and all request/response types are **generated from the
OpenAPI contracts** published by
[`nb-api-specs`](https://github.com/nasebanal/nb-api-specs), so the SDK stays a
pure function of the API contracts — the code-level consumer in the NASEBANAL
Contract-Driven Development (CDD) pipeline, alongside the web frontends and
[`nb-cli`](https://github.com/nasebanal/nb-cli).

```ts
import { NasebanalClient } from "@nasebanal/sdk";

const nb = new NasebanalClient({ auth: { token: process.env.NB_TOKEN } });

const me = await nb.account.me.get();              // typed against the contract
const records = await nb.recorder.records.list();
const token = await nb.account.me.tokens.create({ name: "ci" });
```

## Why an SDK

Without it, a developer hand-rolls `fetch` calls and wires up Auth0 themselves.
The SDK wraps **authentication and API calls** so you get typed methods, base-URL
resolution, and error handling for free — the same idea as the Google Cloud /
Stripe client libraries.

## Installation

Node ≥ 20. `@nasebanal/sdk` is a scoped package on **GitHub Packages**, so point
the registry at it once (`~/.npmrc`):

```ini
@nasebanal:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}   # a PAT with read:packages
```

```bash
npm install @nasebanal/sdk
```

The published package bundles the generated clients, so no `nb-api-specs`
checkout is needed to consume it.

## Authentication

Auth is an injectable concern (the GCP/AWS pattern): the SDK only asks an
`AuthProvider` for a bearer token. Today the **Personal Access Token** strategy
is implemented — enough for server-to-server and scripting.

```ts
import { NasebanalClient, patAuth } from "@nasebanal/sdk";

// Explicit token
new NasebanalClient({ auth: { token: "nbpat_…" } });

// Env-based (NB_TOKEN / NB_PAT) — the default when `auth` is omitted
new NasebanalClient();

// Equivalent, explicit
new NasebanalClient({ auth: patAuth() });
```

Create a PAT in the web app under **Settings → API tokens** (Account API).

> **Planned:** browser / device-code login (Auth0 loopback + PKCE, reusing
> `nb-cli`'s implementation) and M2M (Auth0 client credentials) will plug in as
> additional `AuthProvider`s without changing call sites. See
> [`docs/sdk-design.md`](../docs/sdk-design.md).

## Environments

```ts
new NasebanalClient({ env: "production" }); // default (or NB_ENV=local)
new NasebanalClient({ env: "local" });      // wrangler dev servers from the spec

// Override a base URL entirely (origin only; spec paths are still appended)
new NasebanalClient({ baseUrls: { account: "http://127.0.0.1:8788" } });
```

## Errors & types

- Any non-2xx response throws an `SdkError` carrying `status` and the parsed
  `data` (NASEBANAL errors are `{ error: { code, message } }`).
- Responses are returned **as-is** — the `{ data: … }` envelope is preserved and
  typed, not unwrapped.
- Request/response types are inferred from the client methods, so you rarely
  import named types: `type Me = Awaited<ReturnType<typeof nb.account.me.get>>`.

```ts
import { SdkError } from "@nasebanal/sdk";
try {
  await nb.account.me.get();
} catch (err) {
  if (err instanceof SdkError && err.status === 401) { /* re-auth */ }
}
```

## Command mapping (how methods are derived)

The same deterministic rules as `nb-cli` (`src/spec/build.ts`):

| OpenAPI operation | SDK method |
|-------------------|------------|
| `GET /api/v1/me` (singleton) | `nb.account.me.get()` |
| `GET /api/v1/me/tokens` (collection) | `nb.account.me.tokens.list()` |
| `POST /api/v1/me/tokens` | `nb.account.me.tokens.create(body)` |
| `DELETE /api/v1/me/tokens/{id}` | `nb.account.me.tokens.delete(id)` |
| `POST /api/v1/shares/{id}/accept` (action) | `nb.target.shares.accept(id)` |

Path parameters become positional arguments, a request body is the next
argument, query parameters are a trailing `{ query }` object. Segment names are
camelCased (`accept-terms` → `acceptTerms`).

## Development

```bash
npm install
npm run codegen     # sync specs from a sibling nb-api-specs + generate clients
npm test            # codegen + vitest
npm run typecheck
npm run build       # codegen + tsc -> dist/ (with .d.ts)
```

`npm run build` runs codegen first, so a fresh clone needs either a sibling
`nb-api-specs` checkout or network access to the public specs host
(`NB_SPECS_BASE_URL`).

## Conventions

- **The client surface is generated, not hand-written** — refine it by improving
  the contract in `nb-api-specs`, not by editing `src/generated/`.
- **`specs/` and `src/generated/` are git-ignored** — they are codegen inputs and
  outputs. Codegen is deterministic (CI verifies a second run is byte-identical),
  which keeps the door open to committing the generated clients later if external
  code contributions warrant it (model "A" in `docs/sdk-design.md`).
- **No runtime dependencies** — the SDK is fetch-based and ships zero deps.
