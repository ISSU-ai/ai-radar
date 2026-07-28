'use strict';

/**
 * 아직 적용하지 않은 마이그레이션들을 Supabase SQL Editor 에 한 번에 붙여넣을 수 있는
 * 단일 스크립트로 합친다. 손으로 이어붙이면 순서가 틀리거나 하나를 빠뜨리기 쉽다.
 *
 *   node scripts/build-pending-sql.js                     # 기본 목록으로 생성
 *   node scripts/build-pending-sql.js 010 011 012 013     # 번호로 지정
 *
 * 결과는 db/migrations/_combined_apply.sql 에 쓴다(.gitignore 대상 아님 — 리뷰 가능하게 둔다).
 *
 * ⚠ ALTER TYPE ... ADD VALUE 주의
 *   013 의 enum 추가는 begin; 앞에 두었고, 이 스크립트도 그 순서를 보존한다.
 *   Supabase SQL Editor 가 전체를 하나의 암묵 트랜잭션으로 묶는 경우를 대비해
 *   enum 값을 참조하는 구문은 text 캐스팅으로 바꿔 두었다(013 주석 참조).
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const OUTPUT = path.join(MIGRATIONS_DIR, '_combined_apply.sql');

// 기본값 = 009 이후 아직 적용되지 않은 것들. 012 는 1회성 시드라 apply-migrations.js
// 에는 없지만, 최초 적용에는 포함해야 판정 데이터가 들어간다.
const DEFAULT_ORDER = ['010', '011', '012', '013', '014', '015', '016'];

function resolveFiles(prefixes) {
  const all = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && !f.startsWith('_'));
  return prefixes.map((prefix) => {
    const match = all.find((f) => f.startsWith(`${prefix}_`));
    if (!match) {
      console.error(`마이그레이션 ${prefix} 를 찾을 수 없습니다. 존재하는 파일:`);
      all.sort().forEach((f) => console.error(`  ${f}`));
      process.exit(1);
    }
    return match;
  });
}

function main() {
  const prefixes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ORDER;
  const files = resolveFiles(prefixes);

  const header = [
    '-- ===================================================================',
    '-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)',
    '--',
    '-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.',
    '-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.',
    '--',
    `-- 포함: ${files.join(' → ')}`,
    '--',
    '-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.',
    '--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건',
    '--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건',
    '--   013: enum 에 curator 포함 · 역할별 인원',
    '-- ===================================================================',
    ''
  ].join('\n');

  const body = files
    .map((file) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').trimEnd();
      return [
        '',
        '-- ═══════════════════════════════════════════════════════════════',
        `-- ▼ ${file}`,
        '-- ═══════════════════════════════════════════════════════════════',
        '',
        sql,
        ''
      ].join('\n');
    })
    .join('\n');

  fs.writeFileSync(OUTPUT, `${header}${body}\n`, 'utf8');

  const lines = (header + body).split('\n').length;
  console.log(`생성: ${path.relative(path.join(__dirname, '..'), OUTPUT)}  (${files.length}개 파일, ${lines}줄)`);
  files.forEach((f) => console.log(`   · ${f}`));
  console.log('\nSupabase SQL Editor 에 붙여넣고 실행하세요.');
}

main();
