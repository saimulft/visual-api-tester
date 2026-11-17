import { route } from '@/server/http';
import * as discovery from '@/server/discovery';

/** GET ?q= finds an API's docs: the curated directory first, then APIs.guru. */
export const GET = route(async ({ ctx, query }) => discovery.find(ctx, { q: query.get('q') ?? '' }));
