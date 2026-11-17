import { route } from '@/server/http';
import { datasets } from '@/server/services';

/** A page of rows, newest first (?page, ?pageSize). */
export const GET = route(async ({ ctx, params, query }) => ({
  page: await datasets.rows(ctx, params.id, {
    page: Number(query.get('page')) || 1,
    pageSize: Number(query.get('pageSize')) || 50,
  }),
}));
