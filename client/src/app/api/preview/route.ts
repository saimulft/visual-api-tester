import { checkBody, route } from '@/server/http';
import { PreviewInputSchema } from '@/contracts/workspace';
import { previewRun } from '@/server/runner';

/** POST the Run module's live line: the free match count, the take and the credits. Spends nothing. */
export const POST = route(async ({ ctx, body }) => {
  const input = checkBody(PreviewInputSchema, await body());
  return { preview: await previewRun(ctx, input.projectId, input.values) };
});
