import { route } from '@/server/http';
import { aiKeys } from '@/server/services';

/** PUT { ids } sets the order the keys are tried in. */
export const PUT = route(async ({ ctx, body }) => ({ keys: await aiKeys.reorder(ctx, await body()) }));
