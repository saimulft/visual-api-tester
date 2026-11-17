import { exportResponse } from '@/server/datasets/export';
import { clientIp, MINUTE, rateLimit } from '@/server/http';
import { errorResponse } from '@/server/http/errors';
import { datasets } from '@/server/services';

/**
 * The live CSV link: plain text/csv for Google Sheets' IMPORTDATA. The 32-byte token is the only key, so
 * it's rate-limited per token and per address, and a link that's turned off is a 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    rateLimit(`csv:token:${token.slice(0, 16)}`, 60, MINUTE);
    rateLimit(`csv:ip:${clientIp(req) ?? 'unknown'}`, 120, MINUTE);
    const dataset = await datasets.byCsvToken(token);
    if (!dataset) return new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain' } });
    const res = exportResponse(dataset, 'csv', null, { attachment: false });
    res.headers.set('x-robots-tag', 'noindex');
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
