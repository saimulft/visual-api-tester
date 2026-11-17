import type { SetupStream } from '@/contracts/setup';
import { route } from '@/server/http';
import { setups } from '@/server/setup';

/**
 * The Setup screen's live feed (text/event-stream). Each setup event goes out with its id, so a reconnect sends
 * Last-Event-ID (or ?after=) and picks up where it left off; a `view` message without an id carries the whole
 * screen state whenever the setup changes. The stream ends once the setup is over and everything has gone out.
 */
const POLL_MS = 500;
const KEEPALIVE_MS = 15_000;
const MAX_OPEN_MS = 20 * 60_000;

export const dynamic = 'force-dynamic';

export const GET = route(async ({ ctx, params, req, query }) => {
  const first = await setups.view(ctx, params.id);
  const resumeFrom = Number(req.headers.get('last-event-id') ?? query.get('after') ?? 0) || 0;
  const encoder = new TextEncoder();
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const message = (data: SetupStream, id?: number) =>
        send(
          `${id !== undefined ? `id: ${id}\n` : ''}${data.kind === 'view' ? 'event: view\n' : ''}data: ${JSON.stringify(data)}\n\n`,
        );
      req.signal.addEventListener('abort', () => (closed = true), { once: true });

      send('retry: 2000\n\n');
      message({ kind: 'view', view: first });
      let last = resumeFrom;
      let stamp = (await setups.stamp(params.id))?.updatedAt ?? 0;
      const opened = Date.now();
      let quietSince = Date.now();
      while (!closed && Date.now() - opened < MAX_OPEN_MS) {
        const events = await setups.eventsAfter(params.id, last);
        for (const event of events) {
          message({ kind: 'event', event }, event.id);
          last = event.id;
        }
        const now = await setups.stamp(params.id);
        if (!now) break;
        if (now.updatedAt !== stamp || events.length) {
          stamp = now.updatedAt;
          message({ kind: 'view', view: await setups.view(ctx, params.id) });
          quietSince = Date.now();
        }
        const over = now.status === 'done' || now.status === 'failed' || now.status === 'cancelled';
        if (over && !events.length) break;
        if (Date.now() - quietSince > KEEPALIVE_MS) {
          send(': keepalive\n\n');
          quietSince = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
});
