import { route } from '@/server/http';
import * as discovery from '@/server/discovery';

/** POST { slug, secret } tries a key with one free call before it's saved. */
export const POST = route(async ({ ctx, body }) => ({ result: await discovery.testApiKey(ctx, await body()) }));
