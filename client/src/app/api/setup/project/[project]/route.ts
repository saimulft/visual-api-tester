import { route } from '@/server/http';
import { setups } from '@/server/setup';

/** POST { brief, via? } asks the AI for changes to a set-up project (?change=1 on the Setup page). */
export const POST = route(async ({ ctx, params, body }) =>
  Response.json(await setups.change(ctx, params.project, await body()), { status: 201 }),
);
