// Adapted from dl-cms/cms/src/server/mcp/tools/define.ts
import type { z } from 'zod';
import { ApiError } from '@/contracts/common';
import type { McpCaller } from '../auth';

/** What a tool gets besides its arguments: the caller and Dialed's public origin, for links. */
export type ToolRun = { caller: McpCaller; base: string };

export type ToolOutput = Record<string, unknown>;

export type ToolDef<S extends z.ZodRawShape> = {
  name: string;
  description: string;
  input: S;
  /** Read tools are marked read-only for clients (readOnlyHint). */
  kind: 'read' | 'write';
  destructive?: boolean;
  idempotent?: boolean;
  run(args: z.output<z.ZodObject<S>>, t: ToolRun): Promise<ToolOutput>;
};

export type AnyTool = Omit<ToolDef<z.ZodRawShape>, 'run'> & {
  run(args: Record<string, unknown>, t: ToolRun): Promise<ToolOutput>;
};

/** Typed definition in, uniform tool out (the MCP server validates arguments against `input` first). */
export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): AnyTool {
  return def as unknown as AnyTool;
}

export function requireConfirm(confirm: boolean | undefined, what: string) {
  if (confirm !== true)
    throw new ApiError(
      'confirmation_required',
      `${what} needs confirm: true. Ask the person first, then call again with confirm: true.`,
      400,
    );
}
