/**
 * Thin HTTP layer shared by every generated API client.
 *
 * It owns exactly three things: bearer-token injection (via the AuthProvider),
 * query-string assembly, and turning non-2xx responses into `SdkError`. The
 * generated clients call `request()` with a literal method + path; they never
 * touch fetch directly.
 */
import type { AuthProvider } from "./auth.js";
import { SdkError } from "./errors.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RequestArgs {
  method: HttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: AuthProvider,
  ) {}

  async request<T = unknown>(args: RequestArgs): Promise<T> {
    const url = new URL(this.baseUrl + args.path);
    for (const [key, value] of Object.entries(args.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    const token = await this.auth.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const init: RequestInit = { method: args.method.toUpperCase(), headers };
    if (args.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(args.body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new SdkError(`Request to ${url.host} failed: ${(err as Error).message}`, 0, undefined);
    }

    const text = await res.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        /* leave as raw text */
      }
    }

    if (!res.ok) {
      throw new SdkError(`${res.status} ${res.statusText}`, res.status, data);
    }
    return data as T;
  }
}

export interface ServerEntry {
  url: string;
  description?: string;
}

export type Environment = "production" | "local";

/** Pick the server URL for the active environment from a spec's `servers`. */
export function resolveBaseUrl(servers: ServerEntry[], env: Environment, override?: string): string {
  if (override) return override.replace(/\/$/, "");
  if (!servers.length) throw new Error("No servers declared for this API; pass baseUrls to override.");
  const isLocal = (s: ServerEntry) => /localhost|127\.0\.0\.1/.test(s.url);
  const match = env === "local" ? servers.find(isLocal) : servers.find((s) => !isLocal(s));
  return (match ?? servers[0]).url.replace(/\/$/, "");
}
