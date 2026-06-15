/**
 * `NasebanalClient` — the SDK entry point.
 *
 * Construct once with an auth strategy and an environment, then reach every API
 * through a typed namespace:
 *
 *   const nb = new NasebanalClient({ auth: { token: process.env.NB_TOKEN } });
 *   const me = await nb.account.me.get();          // typed against the contract
 *   const records = await nb.recorder.records.list();
 *
 * Each namespace is generated from the OpenAPI spec, so the method surface and
 * the request/response types stay a pure function of the contract.
 */
import { HttpClient, resolveBaseUrl, type Environment } from "./http.js";
import { normalizeAuth, type AuthProvider } from "./auth.js";
import { createAccountApi, accountServers } from "./generated/account.js";
import { createRecorderApi, recorderServers } from "./generated/recorder.js";
import { createTargetApi, targetServers } from "./generated/target.js";
import { createAppTemplateApi, appTemplateServers } from "./generated/app-template.js";

export interface NasebanalClientOptions {
  /** Auth strategy, or a `{ token }` shorthand. Defaults to env-based PAT auth. */
  auth?: AuthProvider | { token?: string };
  /** Which spec `servers` entry to target. Defaults to `NB_ENV` or production. */
  env?: Environment;
  /** Override the resolved base URL per API (origin only; spec paths are appended). */
  baseUrls?: {
    account?: string;
    recorder?: string;
    target?: string;
    appTemplate?: string;
  };
}

export class NasebanalClient {
  readonly account: ReturnType<typeof createAccountApi>;
  readonly recorder: ReturnType<typeof createRecorderApi>;
  readonly target: ReturnType<typeof createTargetApi>;
  readonly appTemplate: ReturnType<typeof createAppTemplateApi>;

  constructor(options: NasebanalClientOptions = {}) {
    const auth = normalizeAuth(options.auth);
    const env: Environment = options.env ?? (process.env.NB_ENV === "local" ? "local" : "production");
    const overrides = options.baseUrls ?? {};

    const make = (servers: { url: string; description?: string }[], override?: string) =>
      new HttpClient(resolveBaseUrl(servers, env, override), auth);

    this.account = createAccountApi(make(accountServers, overrides.account));
    this.recorder = createRecorderApi(make(recorderServers, overrides.recorder));
    this.target = createTargetApi(make(targetServers, overrides.target));
    this.appTemplate = createAppTemplateApi(make(appTemplateServers, overrides.appTemplate));
  }
}
