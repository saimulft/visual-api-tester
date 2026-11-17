import SwaggerParser from '@apidevtools/swagger-parser';
import { DOCS_LIMITS, fetchDocs } from './fetch';

/**
 * Reads an OpenAPI (or Swagger 2) file through swagger-parser, with every file it needs fetched through the
 * outbound guard (a custom resolver: no local files, no unguarded HTTP). The AI gets a compact view: servers,
 * auth and each endpoint's parameters, body fields and response fields, short enough to read in one go.
 */
type Json = Record<string, unknown>;

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const MAX_ENDPOINTS = 120;
const MAX_ENUM = 25;
const MAX_FIELDS = 40;
const DESC = 200;

const guardedResolver = {
  order: 1,
  canRead: /^https?:\/\//i,
  async read(file: { url: string }) {
    const got = await fetchDocs(file.url, { maxBytes: DOCS_LIMITS.bigBytes, timeoutMs: 20_000 });
    if (!got.ok) throw new Error(`${file.url} answered ${got.status}.`);
    return got.text;
  },
};

const parserOptions = {
  resolve: { file: false, http: false, guarded: guardedResolver },
  dereference: { circular: 'ignore' as const },
  validate: { schema: false, spec: false },
};

/** The parsed document (not dereferenced). Throws when it isn't an OpenAPI or Swagger file. */
export async function parseOpenApi(url: string): Promise<Json> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (await SwaggerParser.parse(url, parserOptions as any)) as unknown as Json;
  if (!api || typeof api !== 'object' || (!('openapi' in api) && !('swagger' in api)) || !api.paths)
    throw new Error('That file isn’t an OpenAPI or Swagger description.');
  return api;
}

/** How many operations a parsed document has. */
export function countOperations(api: Json): number {
  let n = 0;
  for (const item of Object.values((api.paths ?? {}) as Record<string, Json>))
    for (const method of METHODS) if (item && typeof item === 'object' && method in item) n++;
  return n;
}

const short = (text: unknown, max = DESC) => {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

function typeOf(schema: Json | undefined): string {
  if (!schema || typeof schema !== 'object') return 'any';
  if (Array.isArray(schema.type)) return schema.type.filter((t) => t !== 'null').join('|');
  if (schema.type === 'array') return `array of ${typeOf(schema.items as Json)}`;
  if (typeof schema.type === 'string') return schema.format ? `${schema.type} (${schema.format})` : schema.type;
  if (schema.properties) return 'object';
  const union = (schema.oneOf ?? schema.anyOf) as Json[] | undefined;
  if (Array.isArray(union)) return union.map(typeOf).join('|');
  return 'any';
}

const enumOf = (schema: Json | undefined) =>
  Array.isArray(schema?.enum) ? (schema.enum as unknown[]).slice(0, MAX_ENUM).map(String) : undefined;

/** Field paths of a schema, two levels deep: ["hits[]", "hits[].title", "nbHits"]. */
function fieldPaths(schema: Json | undefined, prefix = '', depth = 0, out: string[] = []): string[] {
  if (!schema || typeof schema !== 'object' || out.length >= MAX_FIELDS || depth > 2) return out;
  if (schema.type === 'array' || schema.items) {
    if (prefix) out.push(`${prefix}[]`);
    return fieldPaths(schema.items as Json, `${prefix}[]`, depth + 1, out);
  }
  for (const [name, sub] of Object.entries((schema.properties ?? {}) as Record<string, Json>)) {
    if (out.length >= MAX_FIELDS) break;
    const path = prefix ? `${prefix}.${name}` : name;
    out.push(`${path}: ${typeOf(sub)}`);
    if (sub && (sub.properties || sub.items)) fieldPaths(sub, path, depth + 1, out);
  }
  return out;
}

function jsonSchemaOf(content: unknown): Json | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const entries = Object.entries(content as Record<string, Json>);
  const json = entries.find(([type]) => type.includes('json')) ?? entries[0];
  return json?.[1]?.schema as Json | undefined;
}

export type CompactOpenApi = {
  title: string | null;
  version: string | null;
  servers: string[];
  auth: { name: string; type: string; in?: string; param?: string; scheme?: string }[];
  endpointCount: number;
  endpoints: {
    method: string;
    path: string;
    summary?: string;
    params: { name: string; in: string; required?: boolean; type: string; enum?: string[]; description?: string }[];
    body?: { required?: boolean; fields: string[] };
    returns?: string[];
  }[];
  /** True when the list was cut at MAX_ENDPOINTS. */
  cut: boolean;
};

/** Reads an OpenAPI file and compacts it for the AI. */
export async function readOpenApi(url: string): Promise<CompactOpenApi> {
  await parseOpenApi(url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (await SwaggerParser.dereference(url, parserOptions as any)) as unknown as Json;
  const info = (api.info ?? {}) as Json;
  const servers =
    'swagger' in api
      ? api.host
        ? [`${((api.schemes as string[]) ?? ['https'])[0]}://${api.host}${api.basePath ?? ''}`]
        : []
      : ((api.servers ?? []) as Json[]).map((s) => String(s.url)).filter(Boolean);
  const schemes = (
    'swagger' in api ? api.securityDefinitions : (api.components as Json | undefined)?.securitySchemes
  ) as Record<string, Json> | undefined;
  const auth = Object.entries(schemes ?? {}).map(([name, s]) => ({
    name,
    type: String(s.type),
    ...(s.in ? { in: String(s.in) } : {}),
    ...(s.name ? { param: String(s.name) } : {}),
    ...(s.scheme ? { scheme: String(s.scheme) } : {}),
  }));

  const endpoints: CompactOpenApi['endpoints'] = [];
  let total = 0;
  for (const [path, item] of Object.entries((api.paths ?? {}) as Record<string, Json>)) {
    if (!item || typeof item !== 'object') continue;
    const shared = (item.parameters ?? []) as Json[];
    for (const method of METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      total++;
      if (endpoints.length >= MAX_ENDPOINTS) continue;
      const params = [...shared, ...((op.parameters ?? []) as Json[])]
        .filter((p) => p && p.in !== 'body')
        .map((p) => {
          const schema = (p.schema ?? p) as Json;
          return {
            name: String(p.name),
            in: String(p.in),
            ...(p.required ? { required: true } : {}),
            type: typeOf(schema),
            ...(enumOf(schema) ? { enum: enumOf(schema) } : {}),
            ...(short(p.description) ? { description: short(p.description) } : {}),
          };
        });
      const swaggerBody = ((op.parameters ?? []) as Json[]).find((p) => p.in === 'body');
      const bodySchema = swaggerBody
        ? (swaggerBody.schema as Json)
        : jsonSchemaOf((op.requestBody as Json | undefined)?.content);
      const responses = (op.responses ?? {}) as Record<string, Json>;
      const ok =
        responses['200'] ?? responses['201'] ?? Object.entries(responses).find(([c]) => c.startsWith('2'))?.[1];
      const responseSchema = ok ? ((ok.schema as Json | undefined) ?? jsonSchemaOf(ok.content)) : undefined;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        ...(short(op.summary ?? op.description, 160) ? { summary: short(op.summary ?? op.description, 160) } : {}),
        params,
        ...(bodySchema
          ? {
              body: {
                ...((op.requestBody as Json | undefined)?.required || swaggerBody?.required ? { required: true } : {}),
                fields: fieldPaths(bodySchema),
              },
            }
          : {}),
        ...(responseSchema ? { returns: fieldPaths(responseSchema) } : {}),
      });
    }
  }
  return {
    title: short(info.title, 120) ?? null,
    version: typeof info.version === 'string' ? info.version : null,
    servers,
    auth,
    endpointCount: total,
    endpoints,
    cut: total > endpoints.length,
  };
}
