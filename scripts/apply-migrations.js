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
  '005_solution_pricing.sql',
  '008_tiered_pricing.sql',
  '009_internal_sections_and_price_flags.sql',
  '010_recommendation_engine.sql',
  '011_slot_taxonomy_and_layer_fixes.sql',
  // 012 는 의도적으로 제외 — ISSU 가 /admin 에서 수정한 판정 데이터를 덮어쓰는 1회성 시드다.
  '013_curator_role.sql',
  // 020 은 컬럼·인덱스만 만든다. 021(노출 목록 시드)은 어드민 토글 상태를 덮어쓰므로 제외.
  '020_solution_visibility.sql',
  // 027 도 컬럼만 추가한다. 022~026 은 1회성 시드라 제외.
  '027_lead_contact_fields.sql'
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
