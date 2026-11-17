// Adapted from dl-cms/cms/src/server/ai/meter.ts
import type { ChatInput } from './types';

/**
 * Rough token counts, for what a provider doesn't tell us: the size of the next call, which a budget has to know
 * before it's made, and what a call cost when it was cut off before its usage report (the report comes last, so
 * without this, stopping every answer just before its end would cost nothing). Bytes rather than characters, so
 * scripts that take more tokens per character aren't undercounted. The numbers lean high.
 *
 * Requests are mostly tool schemas and JSON, which are token-dense. Measured on production on 2026-11-07: a short
 * message on Claude Opus 5.5 sent about 131.5 KB and used 53,378 input tokens, about 2.46 bytes a token. Plain
 * English in a long chat takes more bytes per token, so that part of a request is overestimated, which only means
 * a budget stops a little early.
 */
const REQUEST_BYTES_PER_TOKEN = 2.3;
const OUTPUT_BYTES_PER_TOKEN = 3.5;
/** Thinking that was never shown still costs: a cut-off call is charged at least this for the time it ran. */
const TOKENS_PER_SECOND = 150;

type Request = Pick<ChatInput, 'system' | 'messages' | 'tools'>;
type Usage = { inputTokens: number; outputTokens: number };

/** What a request sends, the way the adapters send it. */
export function estimateInputTokens({ system, messages, tools }: Request): number {
  let bytes = Buffer.byteLength(system) + Buffer.byteLength(JSON.stringify(tools));
  for (const message of messages)
    for (const part of message.parts) {
      if (part.type === 'tool_result') bytes += Buffer.byteLength(part.content);
      else bytes += Buffer.byteLength(JSON.stringify(part));
    }
  return Math.ceil(bytes / REQUEST_BYTES_PER_TOKEN);
}

/** A call that ended without a usage report: what was reported, else its request, its output and its time. */
export function cutOffUsage(request: Request, reported: Usage, outputBytes: number, ms: number): Usage {
  return {
    inputTokens: reported.inputTokens || estimateInputTokens(request),
    outputTokens: Math.max(
      reported.outputTokens,
      Math.ceil(outputBytes / OUTPUT_BYTES_PER_TOKEN),
      Math.ceil((ms / 1000) * TOKENS_PER_SECOND),
    ),
  };
}
