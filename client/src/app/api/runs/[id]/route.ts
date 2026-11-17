import { route } from '@/server/http';
import { runs } from '@/server/services';

/** One run in full: its sample rows, masked request log and values. */
export const GET = route(async ({ ctx, params }) => ({ run: await runs.get(ctx, params.id) }));
