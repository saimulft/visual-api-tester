import { z } from 'zod';

/**
 * What the AI setup reports as it works (setup_events rows, streamed to the setup page). One event per thing
 * that happened; `data` depends on `kind`.
 */
export const SETUP_STEPS = [
  { step: 1, label: 'Read the docs' },
  { step: 2, label: 'Pick the endpoints' },
  { step: 3, label: 'Build the controls' },
  { step: 4, label: 'Test call' },
] as const;

export const SetupEventDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('step'), step: z.number().int().min(1).max(4), status: z.enum(['running', 'done', 'failed']) }),
  z.object({ kind: z.literal('log'), text: z.string(), url: z.string().optional() }),
  z.object({ kind: z.literal('endpoint'), endpointId: z.string(), label: z.string(), method: z.enum(['GET', 'POST']), path: z.string() }),
  z.object({
    kind: z.literal('control'),
    channelId: z.string(),
    channelTitle: z.string(),
    controlId: z.string(),
    label: z.string(),
    controlKind: z.string(),
  }),
  z.object({ kind: z.literal('note'), noteKind: z.enum(['limit', 'cost', 'tip']), text: z.string() }),
  z.object({
    kind: z.literal('test'),
    ok: z.boolean(),
    endpointId: z.string(),
    records: z.number().int().nonnegative(),
    ms: z.number().nonnegative(),
    error: z.string().nullable().default(null),
  }),
  z.object({ kind: z.literal('done'), channels: z.number().int(), controls: z.number().int(), specVersion: z.number().int() }),
  z.object({ kind: z.literal('error'), message: z.string(), code: z.string().optional() }),
]);
export type SetupEventData = z.infer<typeof SetupEventDataSchema>;
export type SetupEventKind = SetupEventData['kind'];

export type SetupEvent = { id: number; setupId: string; at: number } & SetupEventData;
