// Adapted from dl-cms/cms/src/server/ai/schema.ts
import { z } from 'zod';
import type { AiTool } from './types';

type Json = Record<string, unknown>;

/** A tool's input as JSON Schema (what the person's model may send), without the `$schema` marker. */
export function toolParameters(input: z.ZodRawShape): Json {
  const schema = z.toJSONSchema(z.object(input), {
    io: 'input',
    unrepresentable: 'any',
    reused: 'inline',
  }) as Json;
  delete schema.$schema;
  return schema;
}

export function aiTool(def: { name: string; description: string; input: z.ZodRawShape }): AiTool {
  return { name: def.name, description: def.description, parameters: toolParameters(def.input) };
}

/** Keywords Gemini's function declarations accept (an OpenAPI 3.0 subset). */
const GEMINI_KEYS = new Set([
  'type',
  'description',
  'enum',
  'properties',
  'required',
  'items',
  'anyOf',
  'nullable',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'title',
  'format',
]);
const GEMINI_STRING_FORMATS = new Set(['enum', 'date-time']);

/**
 * The schema in the subset Gemini accepts: `const` becomes a one-value enum, `oneOf` becomes `anyOf`, a type
 * list with "null" becomes `nullable`, open objects and untyped values become free-form, and unknown keywords
 * go.
 */
export function cleanForGemini(schema: unknown): Json {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'string' };
  const src = schema as Json;
  const out: Json = {};
  let type = src.type;
  if (Array.isArray(type)) {
    const types = type.filter((t) => t !== 'null');
    if (types.length < type.length) out.nullable = true;
    type = types.length === 1 ? types[0] : undefined;
    if (types.length > 1) out.anyOf = types.map((t) => cleanForGemini({ ...src, type: t }));
  }
  if (src.const !== undefined) {
    out.enum = [src.const];
    type ??= typeof src.const === 'number' ? 'number' : 'string';
  }
  const union = (src.anyOf ?? src.oneOf) as unknown[] | undefined;
  if (Array.isArray(union)) {
    const options = union.filter((o) => !(o && (o as Json).type === 'null'));
    if (options.length < union.length) out.nullable = true;
    if (options.length === 1) Object.assign(out, cleanForGemini(options[0]));
    else out.anyOf = options.map(cleanForGemini);
  }
  for (const [key, value] of Object.entries(src)) {
    if (!GEMINI_KEYS.has(key) || key === 'type' || key === 'anyOf' || key in out) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, cleanForGemini(v)]));
    } else if (key === 'items') {
      out.items = cleanForGemini(Array.isArray(value) ? value[0] : value);
    } else if (key === 'format') {
      if (GEMINI_STRING_FORMATS.has(String(value))) out.format = value;
    } else if (key === 'enum' && Array.isArray(value)) {
      out.enum = value.filter((v) => v !== null).map(String);
      if (value.includes(null)) out.nullable = true;
      type = 'string';
    } else {
      out[key] = value;
    }
  }
  if (typeof type === 'string') out.type = type === 'integer' ? 'integer' : type;
  else if (!out.anyOf) out.type = out.properties ? 'object' : 'string';
  // An object without properties (a record of values) has nothing Gemini can describe: free-form JSON.
  if (out.type === 'object' && !out.properties)
    out.description = [out.description, 'A JSON object.'].filter(Boolean).join(' ');
  if (Array.isArray(out.required) && out.properties) {
    const props = out.properties as Json;
    out.required = (out.required as string[]).filter((k) => k in props);
    if (!(out.required as string[]).length) delete out.required;
  }
  if (out.type === 'array' && !out.items) out.items = { type: 'string' };
  return out;
}
