import { route } from '@/server/http';
import { setups } from '@/server/setup';

/** POST "Stop setup". */
export const POST = route(async ({ ctx, params }) => {
  await setups.cancel(ctx, params.id);
  return { view: await setups.view(ctx, params.id) };
});
