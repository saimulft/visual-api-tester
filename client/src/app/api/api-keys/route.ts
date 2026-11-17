import { route } from '@/server/http';
import { apiKeys, settings } from '@/server/services';

/** The API key vault: GET the keys with the projects using them; POST saves one (bound to its host). */
export const GET = route(async ({ ctx }) => settings.apiKeyRows(ctx));

export const POST = route(async ({ ctx, body }) =>
  Response.json({ key: await apiKeys.create(ctx, await body()) }, { status: 201 }),
);
