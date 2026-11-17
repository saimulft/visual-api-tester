import { checkBody, MINUTE, rateLimit, route } from '@/server/http';
import { TestCallInputSchema } from '@/contracts/workspace';
import { testCall } from '@/server/runner';

/** POST a test call: one page of a free endpoint, nothing spent. */
export const POST = route(async ({ ctx, body }) => {
  rateLimit(`test-call:${ctx.user.id}`, 30, MINUTE);
  const input = checkBody(TestCallInputSchema, await body());
  return { result: await testCall(ctx, input.projectId, input.endpointId, input.values) };
});
