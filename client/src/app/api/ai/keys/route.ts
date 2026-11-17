import { route } from '@/server/http';
import { aiKeys } from '@/server/services';

/** The built-in assistant's keys: GET them in the order they're tried; POST adds one (checked with the provider). */
export const GET = route(async ({ ctx }) => ({ keys: await aiKeys.list(ctx) }));

export const POST = route(async ({ ctx, body }) =>
  Response.json({ key: await aiKeys.create(ctx, await body()) }, { status: 201 }),
);
