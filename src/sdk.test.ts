import { describe, it, expect, vi, afterEach } from "vitest";
import { NasebanalClient, SdkError } from "./index.js";

/** Mock global fetch with a single canned JSON response, capturing the request. */
function mockFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("NasebanalClient", () => {
  it("injects the bearer token and hits the resolved base URL", async () => {
    const calls = mockFetch(200, { data: { id: 1, email: "a@b.com" } });
    const nb = new NasebanalClient({
      auth: { token: "nbpat_test" },
      baseUrls: { account: "https://api.example.test" },
    });

    const me = await nb.account.me.get();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.test/api/v1/me");
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer nbpat_test");
    // Response is returned as-is (envelope preserved), typed from the contract.
    expect(me.data?.id).toBe(1);
  });

  it("interpolates path parameters and serializes a JSON body", async () => {
    const calls = mockFetch(201, { data: { id: 9, name: "ci" } });
    const nb = new NasebanalClient({
      auth: { token: "t" },
      baseUrls: { account: "https://api.example.test" },
    });

    await nb.account.me.tokens.create({ name: "ci" });

    expect(calls[0].url).toBe("https://api.example.test/api/v1/me/tokens");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ name: "ci" }));
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("throws SdkError carrying status and body on a non-2xx response", async () => {
    mockFetch(401, { error: { code: "UNAUTHORIZED", message: "no" } });
    const nb = new NasebanalClient({
      auth: { token: "bad" },
      baseUrls: { account: "https://api.example.test" },
    });

    await expect(nb.account.me.get()).rejects.toMatchObject({
      name: "SdkError",
      status: 401,
    });
    await expect(nb.account.me.get()).rejects.toBeInstanceOf(SdkError);
  });

  it("resolves the local server URL when env is 'local'", async () => {
    const calls = mockFetch(200, { data: {} });
    const nb = new NasebanalClient({ auth: { token: "t" }, env: "local" });

    await nb.account.me.get();

    // account spec declares http://localhost:8788 as the local server.
    expect(calls[0].url).toMatch(/^http:\/\/localhost:8788\//);
  });

  // account 1.2.0 added `DELETE /api/v1/me` beside `GET /api/v1/me`. The
  // singular-write rule named it `me`, which overwrote the whole `me`
  // namespace in the generated client — `nb.account.me.get` vanished and every
  // call through it failed. Both must survive.
  it("keeps a namespace and a same-named write side by side", () => {
    const nb = new NasebanalClient({ auth: { token: "t" } });
    expect(typeof nb.account.me.get).toBe("function");
    expect(typeof (nb.account.me as unknown as { delete: unknown }).delete).toBe("function");
  });
});
