import type { Generated } from 'kysely';

/**
 * The columns chat A's migration 0002_a_setup_draft adds to `setups`, merged into chat F's SetupsTable type
 * (schema.ts is chat F's file). Fold these into schema.ts at review.
 */
declare module '../db/schema' {
  interface SetupsTable {
    /** The ApiSpec being built (JSON), which may not pass the contract yet. */
    draft: string | null;
    /** Tool calls the built-in assistant made, for the 80-call limit. */
    tool_calls: Generated<number>;
    /** Endpoints the docs list, from discovery, for "Picked 4 of 31 endpoints". */
    docs_endpoints: number | null;
    /** JSON { [channelId]: string[] }: control labels the AI plans, shown waiting until built. */
    plan: string | null;
  }
}

export {};
