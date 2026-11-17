import type { Migration } from 'kysely/migration';
import * as m0001 from './0001_init';

/**
 * Every migration, in order. A static list (no folder scan) so the standalone build bundles them.
 * Add yours with one line next to the others: `'0002_a_<what>': m0002a,`.
 */
export const migrations: Record<string, Migration> = {
  '0001_init': m0001,
};
