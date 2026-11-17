import type { Kysely } from 'kysely';

/**
 * Chat A: the setup's working spec. The AI builds the spec one operation at a time, and it only passes the
 * contract near the end, so the draft lives on the setup until it does. projects.spec keeps the last spec that
 * passed, which the workspace goes on using while a change setup runs.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('setups').addColumn('draft', 'text').execute();
  await db.schema
    .alterTable('setups')
    .addColumn('tool_calls', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  // The docs' endpoint count from discovery ("Picked 4 of 31 endpoints") and the controls the AI plans per channel.
  await db.schema.alterTable('setups').addColumn('docs_endpoints', 'integer').execute();
  await db.schema.alterTable('setups').addColumn('plan', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('setups').dropColumn('plan').execute();
  await db.schema.alterTable('setups').dropColumn('docs_endpoints').execute();
  await db.schema.alterTable('setups').dropColumn('tool_calls').execute();
  await db.schema.alterTable('setups').dropColumn('draft').execute();
}
