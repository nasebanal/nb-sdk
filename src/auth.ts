/**
 * Authentication strategies for the SDK.
 *
 * Following the GCP/AWS SDK pattern, auth is a separate, injectable concern: the
 * HTTP layer only asks an `AuthProvider` for a bearer token. This is the seam
 * where the future browser / device-code (loopback OAuth, reusing nb-cli's
 * `src/oauth.ts`) and M2M (Auth0 client credentials) providers will plug in.
 *
 * Today only the PAT provider is implemented — enough for server-to-server and
 * scripted use (the same `nbpat_…` tokens the web app issues / `NB_TOKEN` in CI).
 */

/** Anything that can produce a bearer token for outgoing requests. */
export interface AuthProvider {
  /** Resolve the token to send, or `undefined` for an unauthenticated call. */
  getToken(): Promise<string | undefined>;
}

/**
 * Personal Access Token auth. Uses the explicit token if given, otherwise falls
 * back to `NB_TOKEN` / `NB_PAT` in the environment (the CI / scripting path).
 */
export function patAuth(token?: string): AuthProvider {
  return {
    async getToken() {
      return token ?? process.env.NB_TOKEN ?? process.env.NB_PAT;
    },
  };
}

/** No authentication — only useful for public endpoints like `/health`. */
export function noAuth(): AuthProvider {
  return {
    async getToken() {
      return undefined;
    },
  };
}

/** Normalize the `auth` option into an AuthProvider. */
export function normalizeAuth(auth: AuthProvider | { token?: string } | undefined): AuthProvider {
  if (!auth) return patAuth();
  if (typeof (auth as AuthProvider).getToken === "function") return auth as AuthProvider;
  return patAuth((auth as { token?: string }).token);
}
