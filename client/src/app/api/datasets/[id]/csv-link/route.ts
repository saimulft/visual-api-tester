import { route } from '@/server/http';
import { datasets } from '@/server/services';

/** POST makes a new live CSV link (retiring the old one); DELETE turns it off. */
export const POST = route(async ({ ctx, params }) => ({ dataset: await datasets.csvLink(ctx, params.id, true) }));

export const DELETE = route(async ({ ctx, params }) => ({ dataset: await datasets.csvLink(ctx, params.id, false) }));
