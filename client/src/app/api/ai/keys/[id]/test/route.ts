import { route } from '@/server/http';
import { aiKeys } from '@/server/services';

/** POST sends one tiny message with this key and times the answer. */
export const POST = route(async ({ ctx, params }) => ({ result: await aiKeys.test(ctx, params.id) }));
