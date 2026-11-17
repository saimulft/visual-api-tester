import { MINUTE, rateLimit, route } from '@/server/http';
import { searchPlaces } from '@/server/places';

/** GET ?q: cities and countries for the places control (GeoNames, CC BY 4.0). */
export const GET = route(async ({ ctx, query }) => {
  rateLimit(`places:${ctx.user.id}`, 240, MINUTE);
  return { places: searchPlaces((query.get('q') ?? '').slice(0, 80)) };
});
