'use strict';

/**
 * Apply the enablement-hub migrations to the database in DATABASE_URL.
 *
 * DEPLOYMENT.md keeps schema changes manual (render.yaml never touches the
 * schema), so this is a deliberate, run-it-yourself helper — not something the
 * server runs on boot. Each migration file is wrapped in its own begin/commit,
 * so a failure rolls that file back cleanly and nothing partial is left behind.
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
 *     node scripts/apply-migrations.js
 *
 * The files are idempotent (create table if not exists / on conflict do update /
 * drop policy if exists ...), so re-running is safe.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS = [
  '001_enablement_hub.sql',
  '002_release_hardening.sql',
  '003_package_pricing.sql',
  '005_solution_pricing.sql'
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Example:');
    console.error('  DATABASE_URL="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" node scripts/apply-migrations.js');
    process.exit(2);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  await client.connect();
  console.log('Connected. Applying %d migration(s)...\n', MIGRATIONS.length);

  for (const file of MIGRATIONS) {
    const full = path.join(__dirname, '..', 'db', 'migrations', file);
    const sql = fs.readFileSync(full, 'utf8');
    process.stdout.write(`→ ${file} ... `);
    try {
      await client.query(sql);
      console.log('OK');
    } catch (error) {
      console.log('FAILED');
      console.error(`\n  ${error.message}`);
      if (/relation .* does not exist|function .* does not exist/i.test(error.message)) {
        console.error('\n  Looks like the base schema is missing. Apply issu_ai_radar_schema.sql');
        console.error('  first (Supabase SQL Editor), then re-run this script.');
      }
      await client.end();
      process.exit(1);
    }
  }

  console.log('\nAll migrations applied. Verifying seeded rows...');
  const check = await client.query(
    "select (select count(*) from fqa_items) as fqa_items,"
    + " (select count(*) from packages) as packages,"
    + " (select count(*) from tracks) as tracks"
  );
  console.log(check.rows[0]);
  await client.end();
  console.log('Done.');
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exit(1);
});
