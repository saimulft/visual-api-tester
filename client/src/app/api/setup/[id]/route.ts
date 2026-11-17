import { route } from '@/server/http';
import { setups } from '@/server/setup';

/** GET everything the Setup screen draws. */
export const GET = route(async ({ ctx, params }) => ({ view: await setups.view(ctx, params.id) }));
