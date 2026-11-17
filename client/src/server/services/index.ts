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
export * as aiKeys from './ai-keys';
export * as settings from './settings';
export * as usage from './usage';
export * as mcp from './mcp-status';
export { mcpStatus } from './mcp-status';
export { aiSummary } from './ai-keys';
export * as runs from './runs';
export * as presets from './presets';
export * as datasets from './datasets';
export * as schedules from './schedules';
export * as projectStats from './project-stats';
export { requireCheckedEmail, requireUser, type Ctx } from './context';
