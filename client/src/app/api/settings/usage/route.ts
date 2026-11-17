import { route } from '@/server/http';
import { usage } from '@/server/services';

/** GET this week's requests, rows, credits and AI tokens per day. */
export const GET = route(async ({ ctx }) => ({ usage: await usage.week(ctx) }));
