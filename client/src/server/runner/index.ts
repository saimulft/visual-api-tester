/**
 * The runner (chat B): spec plus values in, requests out, rows back. Chat A uses buildRequest, testCall,
 * previewRun and runProject (common.md › Services between chats).
 *
 *   import { testCall } from '@/server/runner';
 *   const result = await testCall(ctx, projectId, 'search', values);
 */
export {
  buildRequest,
  withKey,
  readRecords,
  readTotal,
  readId,
  nextPage,
  type BuiltRequest,
  type PageState,
} from './request';
export { testCall, previewRun, runProject, startRun, estimateCredits, takeOf, type RunOptions } from './run';
export { recallRecords } from './results';
export { CALLS_PER_DAY, CALLS_PER_MINUTE } from './call';
