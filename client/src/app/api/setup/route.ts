import { route } from '@/server/http';
import { setups } from '@/server/setup';

/** POST "Set up project": saves the key, creates the project and its setup, and starts the built-in assistant. */
export const POST = route(async ({ ctx, body }) =>
  Response.json(await setups.start(ctx, await body()), { status: 201 }),
);
