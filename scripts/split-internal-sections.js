'use strict';

/**
 * solutions.sections 안에 섞여 있는 내부 전용 문단(마진·리셀러·PreSales 의견)을
 * solutions.sections_internal 로 옮긴다. 분류 규칙은 lib/section-privacy.js 하나뿐이라
 * 서버의 런타임 마스킹과 절대 어긋나지 않는다.
 *
 * 009_internal_sections_and_price_flags.sql 을 먼저 적용해야 한다.
 *
 * 기본은 dry-run(아무것도 쓰지 않음). 실제 반영은 --apply 를 붙인다.
 *
 *   DATABASE_URL="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
 *     node scripts/split-internal-sections.js            # 미리보기 + 검수 리포트
 *   DATABASE_URL="..." node scripts/split-internal-sections.js --apply
 *
 * 멱등하다. 이미 옮긴 뒤 다시 돌리면 옮길 것이 없다고 보고하고 끝난다.
 * 되돌리려면 sections_internal 의 본문을 해당 섹션 끝에 다시 붙이면 된다
 * (--apply 전에 solutions 테이블을 백업해두는 편이 안전하다).
 */

const { Client } = require('pg');
const {
  extractInternalSections,
  stripInternalSections,
  findResidueLines,
  toSectionsObject
} = require('../lib/section-privacy');

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Example:');
    console.error('  DATABASE_URL="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" node scripts/split-internal-sections.js');
    process.exit(2);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  await client.connect();

  const hasColumn = await client.query(
    "select 1 from information_schema.columns where table_name = 'solutions' and column_name = 'sections_internal'"
  );
  if (hasColumn.rowCount === 0) {
    console.error('solutions.sections_internal 컬럼이 없습니다.');
    console.error('db/migrations/009_internal_sections_and_price_flags.sql 을 먼저 적용하세요.');
    await client.end();
    process.exit(1);
  }

  const { rows } = await client.query(
    'select id, slug, name, sections, sections_internal from solutions order by name'
  );

  console.log(`${APPLY ? '[APPLY]' : '[DRY-RUN]'} 대상 솔루션 ${rows.length}건\n`);

  let changed = 0;
  let movedPairs = 0;
  const residueReport = [];

  for (const row of rows) {
    const sections = toSectionsObject(row.sections);
    const internalNow = extractInternalSections(sections);
    const movedKeys = Object.keys(internalNow);

    if (movedKeys.length === 0) continue;

    const publicSections = stripInternalSections(sections);
    const existingInternal = toSectionsObject(row.sections_internal);

    // 이미 들어 있던 내부 본문은 덮지 않고 뒤에 이어붙인다(재실행 시 중복 방지 포함).
    const mergedInternal = { ...existingInternal };
    for (const [key, text] of Object.entries(internalNow)) {
      const prev = String(mergedInternal[key] || '').trim();
      mergedInternal[key] = prev && !prev.includes(text.trim()) ? `${prev}\n\n${text}` : text;
    }

    for (const [key, text] of Object.entries(publicSections)) {
      const residue = findResidueLines(text);
      residue.forEach((line) => {
        residueReport.push({ name: row.name, key, line: line.trim().slice(0, 140) });
      });
    }

    changed += 1;
    movedPairs += movedKeys.length;
    console.log(`  ${row.name} (${row.slug}) → §${movedKeys.join(', §')} 이동`);

    if (APPLY) {
      await client.query(
        'update solutions set sections = $1, sections_internal = $2 where id = $3',
        [JSON.stringify(publicSections), JSON.stringify(mergedInternal), row.id]
      );
    }
  }

  console.log(`\n변경 대상 솔루션: ${changed}건 / 이동한 (솔루션×섹션) 조합: ${movedPairs}`);

  if (residueReport.length > 0) {
    console.log(`\n⚠ 공개 본문에 남은 위험 키워드 ${residueReport.length}줄 — 사람이 확인하세요:`);
    residueReport.forEach((r) => console.log(`   [${r.name} §${r.key}] ${r.line}`));
  } else {
    console.log('공개 본문 잔여 위험 키워드: 없음');
  }

  if (!APPLY && changed > 0) {
    console.log('\n실제로 반영하려면 --apply 를 붙여 다시 실행하세요.');
  }

  await client.end();
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exit(1);
});
