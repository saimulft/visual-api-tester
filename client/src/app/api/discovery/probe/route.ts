import { route } from '@/server/http';
import * as discovery from '@/server/discovery';

/** POST { url, slug? } reads a docs site: llms.txt, OpenAPI, the sitemap, and the page and endpoint counts. */
export const POST = route(async ({ ctx, body }) => discovery.probe(ctx, await body()));
