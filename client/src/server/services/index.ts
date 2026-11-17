/**
 * The services. One module per area, one function per call, each taking a Ctx first. Route handlers and MCP
 * tools call these. Add yours with one export line next to the others.
 *
 *   import { projects } from '@/server/services';
 *   await projects.get(ctx, id);
 */
export * as auth from './auth';
export * as users from './users';
export * as apiKeys from './api-keys';
export * as projects from './projects';
export { requireCheckedEmail, requireUser, type Ctx } from './context';
