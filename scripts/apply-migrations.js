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
  '027_lead_contact_fields.sql',
  // 031 도 컬럼·인덱스만 만든다. 028~030 은 어휘 정리·문항 시드라 1회성으로 제외.
  '031_deal_readiness.sql',
  // 032 는 컬럼 + 백필이다. 백필은 빈 값에만 채우므로 다시 돌려도 안전하다.
  '032_deal_readiness_source.sql',
  // 041 도 컬럼 + 빈 값 백필이다. 033~040 은 시드·1회성 삭제라 제외.
  // 040(fqa drop)과 겹치는 대상이 없어 순서에 무관하다.
  '041_deal_pipeline_fields.sql',
  // 044 는 컬럼 + 인덱스뿐이다. 값은 기본값이 채운다.
  // 042(공시가 시드)·043(처방문 시드)은 사람이 고친 값을 덮으므로 제외.
  '044_lead_result_token.sql',
  // 045 도 컬럼 하나뿐이다.
  '045_lead_authority_timeline.sql',
  // 046 은 컬럼 + 인덱스. 기존 리드를 소급 판정하지 않는다.
  '046_lead_spam_signals.sql',
  // 047 은 빈 표만 만든다. 내용은 /admin 에서 넣는다.
  '047_case_studies.sql',
  // 048 은 컬럼 셋 + 인덱스. 기존 리드는 전부 미열람으로 남는다(소급 불가).
  '048_lead_result_open.sql',
  // 049 는 컬럼 하나. 기존 딜은 null 로 남는다 — 소급해 채우면 거짓 원본이 된다.
  '049_deal_customer_meta_original.sql',
  // 050 은 빈 표만 만든다. 내용은 허브 딜 화면에서 넣는다.
  '050_meeting_notes.sql',
  // 051 은 컬럼 하나 + stage 제약을 0~5 로 넓힌다. 좁히는 게 아니라 안전하다.
  '051_deal_handoff.sql'
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
    "select (select count(*) from packages) as packages,"
    + " (select count(*) from tracks) as tracks,"
    // 040 이 fqa_items 를 지운다. 없는 표를 세면 여기서 통째로 에러가 난다.
    + " (select count(*) from readiness_items) as readiness_items"
  );
  console.log(check.rows[0]);
  await client.end();
  console.log('Done.');
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exit(1);
});
