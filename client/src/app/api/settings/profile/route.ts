import { route } from '@/server/http';
import { settings } from '@/server/services';

/** PATCH name, workspace, time zone, alert email and mute (Settings › Account and Alerts). */
export const PATCH = route(async ({ ctx, body }) => ({ user: await settings.updateProfile(ctx, await body()) }));
