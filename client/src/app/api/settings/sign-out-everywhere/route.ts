import { route } from '@/server/http';
import { settings } from '@/server/services';

/** POST ends every other session; this one stays signed in. */
export const POST = route(async ({ ctx, token }) => {
  await settings.signOutEverywhere(ctx, token);
});
