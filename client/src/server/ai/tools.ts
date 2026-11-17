// Adapted from dl-cms/cms/src/server/ai/tools.ts and mcp/tools/define.ts (tool calling for the setup loop)
import { z } from 'zod';
import { aiTool } from './schema';
import type { AiTool } from './types';

/**
 * A tool the built-in assistant can call: a name, a plain description, a Zod input and what it does. The
 * arguments are checked before `run`, and a bad call comes back to the model as an error it can fix, never a
 * crash.
 */
export type LoopTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  input: S;
  run: (args: z.output<z.ZodObject<S>>) => Promise<unknown>;
};

export function loopTool<S extends z.ZodRawShape>(def: LoopTool<S>): LoopTool {
  return def as unknown as LoopTool;
}

export const toAiTools = (tools: LoopTool[]): AiTool[] => tools.map(aiTool);

export type ToolOutcome = { content: string; isError: boolean };

/** How long one tool answer may be before it's cut (the model sees that it was). */
const MAX_RESULT_CHARS = 70_000;

export function asContent(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n[cut at ${MAX_RESULT_CHARS} characters]`
    : text;
}

/** Runs one call: checks the arguments, runs the tool, and turns any failure into a message for the model. */
export async function runToolCall(
  tools: LoopTool[],
  name: string,
  args: unknown,
  argError?: string,
): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (!tool)
    return {
      content: `There's no tool called "${name}". Use one of: ${tools.map((t) => t.name).join(', ')}.`,
      isError: true,
    };
  if (argError) return { content: `${argError} Send the arguments as one JSON object.`, isError: true };
  const parsed = z.object(tool.input).safeParse(args ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(arguments)'}: ${i.message}`);
    return { content: `The arguments need a fix:\n${problems.join('\n')}`, isError: true };
  }
  try {
    return { content: asContent(await tool.run(parsed.data)), isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const problems = (error as { problems?: { path: string; message: string }[] }).problems;
    return {
      content: problems?.length
        ? `${message}\n${problems.map((p) => `${p.path || '(spec)'}: ${p.message}`).join('\n')}`
        : message,
      isError: true,
    };
  }
}
