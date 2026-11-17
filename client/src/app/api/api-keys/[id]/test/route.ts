import { route } from '@/server/http';
import { settings } from '@/server/services';

/** POST tests a saved key with a free call. Nothing is spent. */
export const POST = route(async ({ ctx, params }) => settings.testApiKey(ctx, params.id));
