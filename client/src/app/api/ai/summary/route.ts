import { route } from '@/server/http';
import { aiKeys } from '@/server/services';

/** GET the first key's provider and model ("Your AI"). */
export const GET = route(async ({ ctx }) => ({ summary: await aiKeys.summary(ctx) }));
