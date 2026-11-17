import { sql, type ColumnDefinitionBuilder, type Kysely } from 'kysely';
import { autoId, stamps, textDefault } from './helpers';

/**
 * Every table Dialed plans (common.md › Tables). Never edit this file once it has shipped: add
 * 0002_<chat>_<what>.ts instead.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const s = db.schema;
  const userRef = (c: ColumnDefinitionBuilder) => c.notNull().references('users.id').onDelete('cascade');
  const projectRef = (c: ColumnDefinitionBuilder) => c.notNull().references('projects.id').onDelete('cascade');

  await stamps(
    s
      .createTable('users')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('email', 'text', (c) => c.notNull())
      .addColumn('name', 'text', textDefault(''))
      .addColumn('password_hash', 'text')
      .addColumn('email_checked_at', 'bigint')
      .addColumn('workspace', 'text', textDefault(''))
      .addColumn('timezone', 'text', textDefault('UTC'))
      .addColumn('mcp_handle', 'text', (c) => c.notNull())
      .addColumn('alert_email', 'text')
      .addColumn('alerts_muted', 'boolean', (c) => c.notNull().defaultTo(false)),
  ).execute();
  await s.createIndex('users_email_idx').on('users').column('email').unique().execute();
  await s.createIndex('users_mcp_handle_idx').on('users').column('mcp_handle').unique().execute();

  await stamps(
    s
      .createTable('sessions')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('expires_at', 'bigint', (c) => c.notNull())
      .addColumn('last_seen_at', 'bigint', (c) => c.notNull())
      .addColumn('user_agent', 'text')
      .addColumn('ip', 'text'),
    false,
  ).execute();
  await s.createIndex('sessions_user_idx').on('sessions').column('user_id').execute();
  await s.createIndex('sessions_expires_idx').on('sessions').column('expires_at').execute();

  await stamps(
    s
      .createTable('email_tokens')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('purpose', 'text', (c) => c.notNull())
      .addColumn('token_hash', 'text', (c) => c.notNull())
      .addColumn('new_email', 'text')
      .addColumn('expires_at', 'bigint', (c) => c.notNull())
      .addColumn('used_at', 'bigint'),
    false,
  ).execute();
  await s.createIndex('email_tokens_hash_idx').on('email_tokens').column('token_hash').unique().execute();
  await s.createIndex('email_tokens_user_idx').on('email_tokens').columns(['user_id', 'purpose']).execute();

  await stamps(
    s
      .createTable('api_keys')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('api_slug', 'text', (c) => c.notNull())
      .addColumn('api_name', 'text', (c) => c.notNull())
      .addColumn('host', 'text', (c) => c.notNull())
      .addColumn('label', 'text', textDefault(''))
      .addColumn('secret', 'text', (c) => c.notNull())
      .addColumn('last4', 'text', (c) => c.notNull())
      .addColumn('credits_left', 'bigint')
      .addColumn('credits_checked_at', 'bigint')
      .addColumn('last_test_at', 'bigint')
      .addColumn('last_test_ok', 'boolean'),
  ).execute();
  await s.createIndex('api_keys_user_idx').on('api_keys').column('user_id').execute();

  await stamps(
    s
      .createTable('projects')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('api_name', 'text', textDefault(''))
      .addColumn('api_slug', 'text', textDefault(''))
      .addColumn('monogram', 'text', textDefault(''))
      .addColumn('docs_url', 'text', textDefault(''))
      .addColumn('api_key_id', 'text', (c) => c.references('api_keys.id').onDelete('set null'))
      .addColumn('brief', 'text', textDefault(''))
      .addColumn('setup_via', 'text', textDefault('builtin'))
      .addColumn('status', 'text', textDefault('draft'))
      .addColumn('spec', 'text')
      .addColumn('spec_version', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('credit_limit', 'bigint', (c) => c.notNull().defaultTo(1000))
      .addColumn('last_run_at', 'bigint')
      .addColumn('archived_at', 'bigint'),
  ).execute();
  await s.createIndex('projects_user_idx').on('projects').columns(['user_id', 'archived_at']).execute();

  await stamps(
    s
      .createTable('spec_versions')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('project_id', 'text', projectRef)
      .addColumn('version', 'integer', (c) => c.notNull())
      .addColumn('spec', 'text', (c) => c.notNull())
      .addColumn('author', 'text', (c) => c.notNull())
      .addColumn('note', 'text'),
    false,
  ).execute();
  await s
    .createIndex('spec_versions_project_idx')
    .on('spec_versions')
    .columns(['project_id', 'version'])
    .unique()
    .execute();

  await stamps(
    s
      .createTable('presets')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('project_id', 'text', projectRef)
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('values', 'text', (c) => c.notNull()),
  ).execute();
  await s.createIndex('presets_project_idx').on('presets').column('project_id').execute();

  await stamps(
    s
      .createTable('ai_keys')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('provider', 'text', (c) => c.notNull())
      .addColumn('model', 'text', (c) => c.notNull())
      .addColumn('label', 'text', textDefault(''))
      .addColumn('secret', 'text', (c) => c.notNull())
      .addColumn('last4', 'text', (c) => c.notNull())
      .addColumn('position', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('last_test_at', 'bigint')
      .addColumn('last_test_ok', 'boolean')
      .addColumn('last_test_ms', 'integer'),
  ).execute();
  await s.createIndex('ai_keys_user_idx').on('ai_keys').columns(['user_id', 'position']).execute();

  await stamps(
    s
      .createTable('setups')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('project_id', 'text', projectRef)
      .addColumn('via', 'text', (c) => c.notNull())
      .addColumn('status', 'text', textDefault('waiting'))
      .addColumn('ai_key_id', 'text', (c) => c.references('ai_keys.id').onDelete('set null'))
      .addColumn('model', 'text')
      .addColumn('brief', 'text', textDefault(''))
      .addColumn('step', 'integer', (c) => c.notNull().defaultTo(1))
      .addColumn('pages_read', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('controls_built', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('error', 'text')
      .addColumn('started_at', 'bigint')
      .addColumn('finished_at', 'bigint'),
  ).execute();
  await s.createIndex('setups_project_idx').on('setups').columns(['project_id', 'created_at']).execute();

  await stamps(
    autoId(db, s.createTable('setup_events'))
      .addColumn('setup_id', 'text', (c) => c.notNull().references('setups.id').onDelete('cascade'))
      .addColumn('at', 'bigint', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('data', 'text', textDefault('{}')),
    false,
  ).execute();
  await s.createIndex('setup_events_setup_idx').on('setup_events').columns(['setup_id', 'id']).execute();

  await stamps(
    s
      .createTable('ai_usage')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('ai_key_id', 'text', (c) => c.references('ai_keys.id').onDelete('set null'))
      .addColumn('provider', 'text', (c) => c.notNull())
      .addColumn('model', 'text', (c) => c.notNull())
      .addColumn('purpose', 'text', (c) => c.notNull())
      .addColumn('tokens_in', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('tokens_out', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('ok', 'boolean', (c) => c.notNull())
      .addColumn('error', 'text')
      .addColumn('at', 'bigint', (c) => c.notNull()),
    false,
  ).execute();
  await s.createIndex('ai_usage_user_idx').on('ai_usage').columns(['user_id', 'at']).execute();

  await stamps(
    s
      .createTable('datasets')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('project_id', 'text', projectRef)
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('save_mode', 'text', textDefault('append'))
      .addColumn('key_path', 'text')
      .addColumn('key_label', 'text')
      .addColumn('columns', 'text', textDefault('[]'))
      .addColumn('rows', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('bytes', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('runs', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('repeats_skipped', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('csv_token', 'text')
      .addColumn('csv_token_at', 'bigint'),
  ).execute();
  await s.createIndex('datasets_user_idx').on('datasets').columns(['user_id', 'updated_at']).execute();
  await s.createIndex('datasets_csv_token_idx').on('datasets').column('csv_token').unique().execute();

  // Schedules come before runs: runs.schedule_id points at schedules, and schedules.last_run_id stays plain
  // text (no foreign key) so the two tables don't need each other first.
  await stamps(
    s
      .createTable('schedules')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', userRef)
      .addColumn('project_id', 'text', projectRef)
      .addColumn('preset_id', 'text', (c) => c.references('presets.id').onDelete('set null'))
      .addColumn('values', 'text', textDefault('{}'))
      .addColumn('dataset_id', 'text', (c) => c.references('datasets.id').onDelete('set null'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('cadence', 'text', (c) => c.notNull())
      .addColumn('days', 'text', textDefault('[]'))
      .addColumn('day_of_month', 'integer')
      .addColumn('time', 'text', textDefault('09:00'))
      .addColumn('timezone', 'text', textDefault('UTC'))
      .addColumn('credit_limit', 'bigint', (c) => c.notNull().defaultTo(1000))
      .addColumn('email_on_fail', 'boolean', (c) => c.notNull().defaultTo(true))
      .addColumn('email_csv', 'boolean', (c) => c.notNull().defaultTo(false))
      .addColumn('status', 'text', textDefault('on'))
      .addColumn('paused_at', 'bigint')
      .addColumn('next_run_at', 'bigint')
      .addColumn('locked_until', 'bigint')
      .addColumn('last_run_id', 'text'),
  ).execute();
  await s.createIndex('schedules_due_idx').on('schedules').columns(['status', 'next_run_at']).execute();
  await s.createIndex('schedules_user_idx').on('schedules').column('user_id').execute();

  await stamps(
    s
      .createTable('runs')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('project_id', 'text', projectRef)
      .addColumn('user_id', 'text', userRef)
      .addColumn('trigger', 'text', (c) => c.notNull())
      .addColumn('preset_id', 'text', (c) => c.references('presets.id').onDelete('set null'))
      .addColumn('schedule_id', 'text', (c) => c.references('schedules.id').onDelete('set null'))
      .addColumn('values', 'text', textDefault('{}'))
      .addColumn('status', 'text', textDefault('running'))
      .addColumn('matches', 'bigint')
      .addColumn('rows', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('credits', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('http_status', 'integer')
      .addColumn('error_code', 'text')
      .addColumn('error_text', 'text')
      .addColumn('retries', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('requests', 'text', textDefault('[]'))
      .addColumn('sample', 'text')
      .addColumn('dataset_id', 'text', (c) => c.references('datasets.id').onDelete('set null'))
      .addColumn('new_rows', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('started_at', 'bigint', (c) => c.notNull())
      .addColumn('finished_at', 'bigint'),
    false,
  ).execute();
  await s.createIndex('runs_project_idx').on('runs').columns(['project_id', 'started_at']).execute();
  await s.createIndex('runs_user_idx').on('runs').columns(['user_id', 'started_at']).execute();

  await stamps(
    autoId(db, s.createTable('dataset_rows'))
      .addColumn('dataset_id', 'text', (c) => c.notNull().references('datasets.id').onDelete('cascade'))
      .addColumn('run_id', 'text', (c) => c.references('runs.id').onDelete('set null'))
      .addColumn('row_key', 'text')
      .addColumn('data', 'text', (c) => c.notNull()),
    false,
  ).execute();
  await s.createIndex('dataset_rows_run_idx').on('dataset_rows').columns(['dataset_id', 'run_id']).execute();
  await s
    .createIndex('dataset_rows_key_idx')
    .on('dataset_rows')
    .columns(['dataset_id', 'row_key'])
    .unique()
    .where('row_key', 'is not', null)
    .execute();

  await stamps(
    s
      .createTable('jobs')
      .addColumn('name', 'text', (c) => c.primaryKey())
      .addColumn('next_run_at', 'bigint', (c) => c.notNull())
      .addColumn('locked_until', 'bigint')
      .addColumn('last_run_at', 'bigint')
      .addColumn('last_status', 'text')
      .addColumn('last_error', 'text'),
  ).execute();

  // OAuth for the MCP server, ported from the CMS's mcp_oauth_clients, mcp_oauth_codes and mcp_tokens.
  await stamps(
    s
      .createTable('oauth_clients')
      .addColumn('client_id', 'text', (c) => c.primaryKey())
      .addColumn('data', 'text', (c) => c.notNull())
      .addColumn('client_name', 'text', textDefault('')),
    false,
  ).execute();

  await stamps(
    s
      .createTable('oauth_codes')
      .addColumn('code_hash', 'text', (c) => c.primaryKey())
      .addColumn('data', 'text', (c) => c.notNull())
      .addColumn('expires_at', 'bigint', (c) => c.notNull()),
    false,
  ).execute();
  await s.createIndex('oauth_codes_expires_idx').on('oauth_codes').column('expires_at').execute();

  await s
    .createTable('oauth_tokens')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('access_hash', 'text', (c) => c.notNull().unique())
    .addColumn('refresh_hash', 'text', (c) => c.unique())
    .addColumn('client_id', 'text', (c) => c.notNull())
    .addColumn('client_name', 'text', textDefault(''))
    .addColumn('user_id', 'text', userRef)
    .addColumn('resource', 'text', (c) => c.notNull())
    .addColumn('scope', 'text', textDefault(''))
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .addColumn('expires_at', 'bigint', (c) => c.notNull())
    .addColumn('refresh_expires_at', 'bigint')
    .addColumn('revoked_at', 'bigint')
    .addColumn('last_used_at', 'bigint')
    .execute();
  await s.createIndex('oauth_tokens_user_idx').on('oauth_tokens').column('user_id').execute();
  await s
    .createIndex('oauth_tokens_resource_idx')
    .on('oauth_tokens')
    .column('resource')
    .where(sql.ref('revoked_at'), 'is', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'oauth_tokens',
    'oauth_codes',
    'oauth_clients',
    'jobs',
    'dataset_rows',
    'runs',
    'schedules',
    'datasets',
    'ai_usage',
    'setup_events',
    'setups',
    'ai_keys',
    'presets',
    'spec_versions',
    'projects',
    'api_keys',
    'email_tokens',
    'sessions',
    'users',
  ])
    await db.schema.dropTable(table).ifExists().execute();
}
