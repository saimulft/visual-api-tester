import { route } from '@/server/http';
import { setups } from '@/server/setup';

/** POST "Try again": a new setup with the same brief. */
export const POST = route(async ({ ctx, params }) => setups.retry(ctx, params.id));
