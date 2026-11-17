import { route } from '@/server/http';
import { aiKeys } from '@/server/services';

/** POST { provider, secret } or { keyId }: the provider's live model list, the recommended one marked. */
export const POST = route(async ({ ctx, body }) => aiKeys.models(ctx, await body()));
