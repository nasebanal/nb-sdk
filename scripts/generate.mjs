#!/usr/bin/env node
/**
 * Generate typed API clients from the OpenAPI specs in specs/.
 *
 * For each API this emits src/generated/<api>.ts containing:
 *   - TS interfaces/types from components.schemas
 *   - a `<api>Servers` constant (baked so the runtime needs no YAML)
 *   - a `create<Api>Api(http)` factory exposing namespaced, typed methods
 *
 * The path -> namespace.method mapping mirrors nb-cli's `src/spec/build.ts`
 * (collection -> list/create, singleton -> get, item -> get/update/delete,
 * singular write segment -> action). Output is deterministic: it preserves spec
 * declaration order and contains no timestamps, so re-running on an unchanged
 * spec yields a byte-identical file (important for the future "commit generated
 * artifacts" contribution model — see docs/sdk-design.md).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const specsDir = join(root, "specs");
const outDir = join(root, "src", "generated");

// name -> { factory/servers identifiers }. Keep in sync with sync-specs.mjs.
const APIS = [
  { name: "account", pascal: "Account", varName: "account" },
  { name: "recorder", pascal: "Recorder", varName: "recorder" },
  { name: "target", pascal: "Target", varName: "target" },
  { name: "app-template", pascal: "AppTemplate", varName: "appTemplate" },
];

const METHODS = ["get", "post", "put", "patch", "delete"];
const PLURAL_VERB = { get: "list", post: "create", put: "replace", patch: "update", delete: "delete" };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const stripBasePath = (p) => p.replace(/^\/api\/v1(?=\/|$)/, "") || "/";
const pathParams = (p) => [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const isPlural = (s) => /s$/.test(s) && !/ss$/.test(s);
const refName = (ref) => ref.split("/").pop();

const isIdent = (s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
function camel(s) {
  const parts = s.split(/[-_]/).filter(Boolean);
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** Command chain for an operation, e.g. ["me","tokens","list"]. Mirrors build.ts. */
function commandChain(method, path) {
  const segments = stripBasePath(path).split("/").filter(Boolean);
  const nonParam = segments.filter((s) => !s.startsWith("{"));
  const last = segments[segments.length - 1] ?? "";

  if (last.startsWith("{")) {
    const verb = method === "get" ? "get" : PLURAL_VERB[method];
    return [...nonParam, verb];
  }
  const leafSegment = nonParam[nonParam.length - 1] ?? "";
  const prefix = nonParam.slice(0, -1);
  if (method === "get") return [...nonParam, isPlural(leafSegment) ? "list" : "get"];
  if (isPlural(leafSegment)) return [...nonParam, PLURAL_VERB[method]];
  return [...prefix, leafSegment];
}

// ---------------------------------------------------------------------------
// Schema -> TypeScript
// ---------------------------------------------------------------------------

function tsType(schema) {
  if (!schema || typeof schema !== "object") return "unknown";
  if (schema.$ref) return refName(schema.$ref);
  if (Array.isArray(schema.allOf)) return schema.allOf.map(tsType).join(" & ") || "unknown";
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(tsType).join(" | ") || "unknown";
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(tsType).join(" | ") || "unknown";

  const t = schema.type;
  let base;
  if (schema.enum && (t === "string" || t === "integer" || t === "number")) {
    const vals = schema.enum.filter((v) => v !== null && v !== undefined);
    const lits = vals.map((v) => (t === "string" ? JSON.stringify(v) : String(v)));
    base = lits.length ? lits.join(" | ") : t === "string" ? "string" : "number";
  } else if (t === "array") {
    const item = tsType(schema.items);
    base = /[ |&]/.test(item) ? `(${item})[]` : `${item}[]`;
  } else if (t === "object" || schema.properties) {
    base = objectType(schema);
  } else if (t === "integer" || t === "number") {
    base = "number";
  } else if (t === "boolean") {
    base = "boolean";
  } else if (t === "string") {
    base = "string";
  } else {
    base = "unknown";
  }
  if (schema.nullable) base = `${base} | null`;
  return base;
}

function fieldLines(schema) {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.keys(props).map((k) => {
    const opt = required.has(k) ? "" : "?";
    const key = isIdent(k) ? k : JSON.stringify(k);
    return `  ${key}${opt}: ${tsType(props[k])};`;
  });
}

function objectType(schema) {
  const props = schema.properties ?? {};
  const keys = Object.keys(props);
  // Index signature, not Record<…>: a spec schema may be named "Record" and
  // shadow the global utility type.
  if (!keys.length) return "{ [key: string]: unknown }";
  const required = new Set(schema.required ?? []);
  const fields = keys.map((k) => {
    const opt = required.has(k) ? "" : "?";
    const key = isIdent(k) ? k : JSON.stringify(k);
    return `${key}${opt}: ${tsType(props[k])}`;
  });
  return `{ ${fields.join("; ")} }`;
}

function emitSchema(name, schema) {
  const isObject = (schema.type === "object" || schema.properties) && !schema.enum && !schema.$ref && !schema.nullable;
  if (isObject && schema.properties) {
    return `export interface ${name} {\n${fieldLines(schema).join("\n")}\n}`;
  }
  return `export type ${name} = ${tsType(schema)};`;
}

// ---------------------------------------------------------------------------
// Operations -> methods
// ---------------------------------------------------------------------------

function resolveParam(param, spec) {
  if (param && param.$ref) {
    const node = (spec.components?.parameters ?? {})[refName(param.$ref)];
    return node ?? null;
  }
  return param;
}

function jsonSchemaOf(container) {
  return container?.content?.["application/json"]?.schema;
}

function successResponse(op) {
  for (const code of ["200", "201", "202"]) {
    const r = op.responses?.[code];
    if (r && jsonSchemaOf(r)) return jsonSchemaOf(r);
  }
  return null;
}

function pathExpr(path) {
  // `/api/v1/me/tokens/{id}` -> "`/api/v1/me/tokens/${encodeURIComponent(id)}`"
  const body = path.replace(/\{([^}]+)\}/g, (_, p) => `\${encodeURIComponent(${camel(p)})}`);
  return "`" + body + "`";
}

function buildMethod(op, path, method, spec) {
  const params = pathParams(path).map(camel);
  const allParams = [...(spec.paths[path].parameters ?? []), ...(op.parameters ?? [])]
    .map((p) => resolveParam(p, spec))
    .filter(Boolean);
  const queryParams = allParams.filter((p) => p.in === "query");

  const bodySchema = jsonSchemaOf(op.requestBody);
  const bodyType = bodySchema ? tsType(bodySchema) : null;
  const bodyRequired = bodySchema ? Boolean(op.requestBody.required) : false;

  const queryType = queryParams.length
    ? `{ ${queryParams
        .map((q) => `${isIdent(q.name) ? q.name : JSON.stringify(q.name)}${q.required ? "" : "?"}: ${tsType(q.schema)}`)
        .join("; ")} }`
    : null;

  const resType = tsType(successResponse(op)) || "unknown";

  const sig = [
    ...params.map((p) => `${p}: string`),
    ...(bodyType ? [`body${bodyRequired ? "" : "?"}: ${bodyType}`] : []),
    ...(queryType ? [`query?: ${queryType}`] : []),
  ].join(", ");

  const reqFields = [`method: "${method}"`, `path: ${pathExpr(path)}`];
  if (queryType) reqFields.push("query");
  if (bodyType) reqFields.push("body");

  return { sig, resType, reqFields, summary: op.summary };
}

// ---------------------------------------------------------------------------
// Namespace tree
// ---------------------------------------------------------------------------

const METHOD = Symbol("method");

function insert(tree, chain, leaf) {
  const groups = chain.slice(0, -1).map(camel);
  const name = camel(chain[chain.length - 1]);
  let node = tree;
  for (const g of groups) {
    if (!node[g] || node[g][METHOD]) node[g] = node[g] && node[g][METHOD] ? node[g] : {};
    node = node[g];
  }
  node[name] = { [METHOD]: leaf };
}

function serializeTree(node, indent) {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  const keys = Object.keys(node).sort();
  const lines = keys.map((key) => {
    const value = node[key];
    const k = isIdent(key) ? key : JSON.stringify(key);
    if (value[METHOD]) {
      const m = value[METHOD];
      const doc = m.summary ? `${inner}/** ${m.summary} */\n` : "";
      return (
        `${doc}${inner}${k}(${m.sig}): Promise<${m.resType}> {\n` +
        `${inner}  return http.request<${m.resType}>({ ${m.reqFields.join(", ")} });\n` +
        `${inner}}`
      );
    }
    return `${inner}${k}: ${serializeTree(value, indent + 1)}`;
  });
  return `{\n${lines.join(",\n")}\n${pad}}`;
}

// ---------------------------------------------------------------------------
// Per-API file
// ---------------------------------------------------------------------------

function generateApi(api) {
  const specFile = join(specsDir, `${api.name}.yaml`);
  const header =
    `// AUTO-GENERATED from specs/${api.name}.yaml by scripts/generate.mjs — do not edit.\n` +
    `import type { HttpClient } from "../http.js";\n\n`;

  if (!existsSync(specFile)) {
    // Emit a stub so the package still compiles when a spec is unavailable.
    return (
      header +
      `// Spec specs/${api.name}.yaml was not found at generation time.\n` +
      `export const ${api.varName}Servers: { url: string; description?: string }[] = [];\n\n` +
      `export function create${api.pascal}Api(_http: HttpClient) {\n  return {};\n}\n`
    );
  }

  const spec = parse(readFileSync(specFile, "utf8"));

  // Schemas
  const schemas = spec.components?.schemas ?? {};
  const schemaBlock = Object.entries(schemas)
    .map(([name, schema]) => emitSchema(name, schema))
    .join("\n\n");

  // Servers
  const servers = (spec.servers ?? []).map((s) => ({ url: s.url, description: s.description }));
  const serversBlock =
    `export const ${api.varName}Servers: { url: string; description?: string }[] = ` +
    `${JSON.stringify(servers, null, 2)};`;

  // Operations -> dedupe by chain (most path params wins), then build tree
  const byChain = new Map();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const chain = commandChain(method, path);
      const key = chain.join(" ");
      const existing = byChain.get(key);
      if (!existing || pathParams(path).length > pathParams(existing.path).length) {
        byChain.set(key, { chain, path, method, op });
      }
    }
  }

  const tree = {};
  for (const { chain, path, method, op } of byChain.values()) {
    insert(tree, chain, buildMethod(op, path, method, spec));
  }

  const factory =
    `export function create${api.pascal}Api(http: HttpClient) {\n` +
    `  return ${serializeTree(tree, 1)};\n}`;

  return [header + schemaBlock, serversBlock, factory].join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
let count = 0;
for (const api of APIS) {
  const code = generateApi(api);
  writeFileSync(join(outDir, `${api.name}.ts`), code);
  console.log(`  ${api.name.padEnd(14)} -> src/generated/${api.name}.ts`);
  count++;
}
console.log(`\nGenerated ${count} client(s) into src/generated/`);
