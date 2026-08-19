'use strict';

/**
 * ⚠ /admin 화면이 <script> 로 불러온다. **IIFE 로 감싸지 않으면** top-level const 가
 *   전역에서 겹쳐 SyntaxError 로 죽는다 — node require 검사는 통과하고 브라우저에서만
 *   터진다. handoff-doc 에서 이미 두 번 데였다.
 */
(function wrap(global) {

/**
 * 카탈로그 일괄 임포트 (052).
 *
 * 8/28 에 Offering Catalog 가 확정되고 **9/4 에 검색 허브를 연다.** 엿새에 수십 종을
 * 넣어야 하는데 지금은 `/admin` 에서 한 건씩 폼으로 넣는다. 그게 유일한 진짜 병목이다.
 *
 * ⚠ **컬럼 이름을 코드에 박지 않는다.** 어떤 서식이 올지 모른다. 첫 줄을 읽어
 *   「이 컬럼 → 이 필드」를 사람이 고르게 한다. 8/28 에 컬럼이 달라도 매핑만 다시
 *   고르면 되고 코드는 안 고친다.
 *
 * ⚠ **판정 데이터를 임포트하지 않는다.** `assessment_coverage`·`prerequisites`·
 *   `red_flags` 는 ISV BU 검토가 필요한 값이다. 엑셀에서 들어오면 그 검토를 건너뛴다.
 *   임포트는 **카탈로그 본문까지**다.
 *
 * ⚠ **들어온 것은 전부 draft 다.** 검토 안 된 것이 전 직원에게 보이면 안 된다.
 *
 * ⚠ **slug 자동 매칭은 절반만 맞는다.** ISV 마스터를 실제로 대조해 보니 기존 22종 중
 *   10종이 표기가 달라 안 맞았다(`Anthropic`↔`anthropic-claude` ·
 *   `Checkpoint`↔`check-point` · `Salesforce - Slack`↔`slack`). 그래서 **짝짓기를
 *   제안하되 확정은 사람이 한다** — 「모르면 판정하지 않는다」.
 */

const asArray = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (value === null || value === undefined ? '' : String(value));
const trim = (value) => text(value).trim();

/**
 * 임포트가 채울 수 있는 필드. **판정 데이터는 여기 없다.**
 *
 * `kind`(Product/Service/Solution) 자리는 비워 뒀다 — 8/28 에 세 유형이 확정되면
 * 여기 한 줄만 늘리면 되고 임포트를 다시 짜지 않는다.
 */
const IMPORT_FIELDS = Object.freeze([
  Object.freeze({ key: 'name', label: '제품·회사명 (EN)', required: true,
    hints: ['company name', 'name', '회사명', '제품명', '솔루션명', 'vendor'] }),
  Object.freeze({ key: 'name_kr', label: '한글명', hints: ['회사명 (kr)', '한글', 'korean', 'kr'] }),
  Object.freeze({ key: 'website', label: '웹사이트', hints: ['website', 'url', '홈페이지', '사이트'] }),
  Object.freeze({ key: 'slug', label: 'slug (비우면 자동)', hints: ['slug', '식별자'] }),
  Object.freeze({ key: 'category', label: '카테고리', hints: ['category', '카테고리', '분류'] }),
  Object.freeze({ key: 'jtbd', label: '해결하는 문제', hints: ['jtbd', '문제', '목적', 'value prop'] }),
  Object.freeze({ key: 'delivery', label: '제공 형태', hints: ['delivery', '제공', 'saas', '배포'] }),
  Object.freeze({ key: 'layer', label: '레이어', hints: ['layer', '레이어', '계층'] }),
  Object.freeze({ key: 'synergy', label: 'MZC 시너지', hints: ['synergy', '시너지'] }),
  Object.freeze({ key: 'value_chain', label: '밸류체인', hints: ['value chain', '밸류', '체인'] }),
  Object.freeze({ key: 'scale', label: '규모급', hints: ['scale', '규모'] }),
  Object.freeze({ key: 'grade', label: '등급', hints: ['grade', '등급', '급'] }),
  Object.freeze({ key: 'note', label: '비고', hints: ['note', '비고', '메모'] })
]);

const FIELD_KEYS = Object.freeze(IMPORT_FIELDS.map((f) => f.key));
/** 숫자로 저장되는 칸. 빈 값은 null 로 둔다 — 0 으로 채우면 「미입력」과 구분이 안 된다. */
const NUMERIC_FIELDS = new Set(['grade']);

/* ── 붙여넣기 파싱 ────────────────────────────────────────────────────────── */

/**
 * 탭/쉼표를 스스로 가른다. **엑셀에서 복사하면 탭**이고 CSV 파일이면 쉼표다.
 * 사람에게 「구분자가 무엇입니까」를 묻지 않는다 — 그건 우리가 셀 수 있다.
 */
function detectDelimiter(line) {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs >= commas && tabs > 0 ? '\t' : ',';
}

/** 따옴표 안의 구분자·줄바꿈을 지킨다. 회사명에 쉼표가 흔하다(`Flex, Inc.`). */
function parseDelimited(raw) {
  const source = text(raw).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!source.trim()) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(source.split('\n')[0]);

  const table = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); table.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(cell);
  table.push(row);

  const headers = (table.shift() || []).map((h) => trim(h));
  const width = headers.length;
  const rows = table
    .map((cells) => Array.from({ length: width }, (_, i) => trim(cells[i])))
    .filter((cells) => cells.some(Boolean));       // 빈 줄은 버린다
  return { headers, rows, delimiter };
}

/* ── 컬럼 매핑 ────────────────────────────────────────────────────────────── */

const squash = (value) => text(value).toLowerCase().replace(/[\s_()[\]{}·*]/g, '');

/**
 * 첫 줄을 보고 매핑을 **제안**한다. 확정은 화면에서 사람이 한다.
 * 못 맞춘 컬럼은 조용히 버리지 않고 「미매핑」으로 남는다.
 */
function suggestMapping(headers) {
  const used = new Set();
  return asArray(headers).map((header) => {
    const key = squash(header);
    if (!key) return null;
    const hit = IMPORT_FIELDS.find((field) => !used.has(field.key)
      && field.hints.some((hint) => {
        const h = squash(hint);
        return key === h || key.startsWith(h) || h.startsWith(key);
      }));
    if (hit) used.add(hit.key);
    return hit ? hit.key : null;
  });
}

/* ── slug ─────────────────────────────────────────────────────────────────── */

/**
 * 이름에서 slug 를 만든다. **괄호 안은 버린다** — 마스터에 모회사·구명이 괄호로
 * 섞여 있다(`AppDynamics (Cisco)`). 그건 이름이 아니라 관계 정보다.
 *
 * 한글만 남으면 slug 로 못 쓴다. 그때는 빈 문자열을 돌려주고 **사람이 지정**한다
 * (KCC정보통신 → kccinfo · KS고용정보 → ksinfo).
 */
function slugify(name) {
  const cleaned = text(name)
    .replace(/[(（][^)）]*[)）]/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ');
  // ⚠ 한글이 더 많으면 만들지 않는다. `KCC정보통신` 에서 ASCII 만 남기면 `kcc` 가
  //   되는데 그건 이름이 아니라 조각이다 — 뜻도 없고 다른 회사와 부딪친다.
  const hangul = (cleaned.match(/[가-힣]/g) || []).length;
  const latin = (cleaned.match(/[a-zA-Z0-9]/g) || []).length;
  if (hangul > 0 && hangul >= latin) return '';
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** 표기 흔들림을 걷어낸 비교용 키. `check-point` 와 `Checkpoint` 가 같아진다. */
const compareKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * 기존 카탈로그와 짝을 찾는다. **확정하지 않고 제안만 한다.**
 *
 *   exact       slug 가 같다              → 자동 선택
 *   normalized  표기만 다르다             → 자동 선택 (check-point ↔ Checkpoint)
 *   partial     한쪽이 다른 쪽을 포함한다  → **사람이 확인해야 한다**
 *
 * partial 을 자동 선택하지 않는 이유 — `Rabbit` 과 `FollowerRabbit` 이 걸린다.
 * 다른 회사다. 자동으로 묶으면 남의 카탈로그를 덮어쓴다.
 */
function matchExisting(name, slug, existing) {
  const rows = asArray(existing);
  const wanted = trim(slug) || slugify(name);
  if (wanted) {
    const exact = rows.find((row) => row.slug === wanted);
    if (exact) return { slug: exact.slug, name: exact.name, confidence: 'exact' };
  }
  const key = compareKey(wanted || name);
  if (!key) return null;
  const normalized = rows.find((row) => compareKey(row.slug) === key || compareKey(row.name) === key);
  if (normalized) return { slug: normalized.slug, name: normalized.name, confidence: 'normalized' };

  // 길이 가드 — 짧은 조각이 아무 데나 걸리는 것을 막는다.
  if (key.length < 5) return null;
  const partial = rows.find((row) => {
    const other = compareKey(row.slug);
    return other.length >= 5 && (other.includes(key) || key.includes(other));
  });
  return partial ? { slug: partial.slug, name: partial.name, confidence: 'partial' } : null;
}

/* ── 실행 계획 ────────────────────────────────────────────────────────────── */

/**
 * 넣기 **전에** 무슨 일이 벌어지는지 센다. 되돌릴 수 없는 일괄 작업이다.
 *
 * @param mapping  headers 와 같은 길이의 배열. 각 칸은 필드 key 또는 null
 * @param decisions 행 index → 확정된 slug. 화면에서 사람이 고른 짝
 */
function buildPlan({ headers = [], rows = [], mapping = [], existing = [], decisions = {} } = {}) {
  const bySlug = new Map(asArray(existing).map((row) => [row.slug, row]));
  const mapped = asArray(mapping);
  const usedFields = new Set(mapped.filter((f) => FIELD_KEYS.includes(f)));

  const unmapped = asArray(headers)
    .map((header, i) => (FIELD_KEYS.includes(mapped[i]) ? null : trim(header)))
    .filter(Boolean);

  const create = [];
  const update = [];
  const blocked = [];
  const seen = new Set();

  asArray(rows).forEach((cells, index) => {
    const values = {};
    mapped.forEach((field, i) => {
      // ⚠ mapping 은 화면에서 온다. 허용목록 밖이면 버린다 — 안 그러면 매핑 한 줄로
      //   unit_price·status·opinion 을 덮어쓸 수 있다. 임포트가 채우는 칸은 정해져 있다.
      if (!field || !FIELD_KEYS.includes(field)) return;
      const raw = trim(cells[i]);
      if (raw === '') return;
      values[field] = NUMERIC_FIELDS.has(field) ? Number(raw) : raw;
    });
    if (NUMERIC_FIELDS.has('grade') && values.grade !== undefined && !Number.isFinite(values.grade)) {
      delete values.grade;
    }

    const name = trim(values.name);
    if (!name) { blocked.push({ index, reason: '이름이 비어 있습니다' }); return; }

    // 사람이 고른 짝이 있으면 그것이 최우선이다.
    const chosen = trim(decisions[index]);
    const guess = chosen ? null : matchExisting(name, values.slug, existing);
    const targetSlug = chosen || (guess && guess.confidence !== 'partial' ? guess.slug : '')
      || trim(values.slug) || slugify(name);

    if (!targetSlug) {
      blocked.push({ index, name, reason: 'slug 를 만들 수 없습니다 — 직접 지정하세요' });
      return;
    }
    if (seen.has(targetSlug)) {
      blocked.push({ index, name, slug: targetSlug, reason: '같은 붙여넣기 안에 중복입니다' });
      return;
    }
    seen.add(targetSlug);

    const entry = {
      index, name, slug: targetSlug, values: { ...values, slug: targetSlug },
      suggestion: guess && guess.confidence === 'partial' ? guess : null
    };
    if (bySlug.has(targetSlug)) {
      const before = bySlug.get(targetSlug);
      entry.existingName = before.name;
      entry.changes = Object.keys(entry.values)
        .filter((key) => key !== 'slug' && trim(before[key]) !== trim(entry.values[key]));
      // 바뀌는 게 없으면 UPDATE 를 보내지 않는다 — updated_at 만 흔들린다.
      (entry.changes.length ? update : blocked).push(
        entry.changes.length ? entry : { index, name, slug: targetSlug, reason: '바뀌는 값이 없습니다' }
      );
    } else {
      create.push(entry);
    }
  });

  return {
    create, update, blocked, unmapped,
    fields: FIELD_KEYS.filter((key) => usedFields.has(key)),
    total: asArray(rows).length
  };
}

const api = {
  IMPORT_FIELDS, FIELD_KEYS,
  parseDelimited, detectDelimiter, suggestMapping,
  slugify, compareKey, matchExisting, buildPlan
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.IssuCatalogImport = api;
})(typeof window === 'undefined' ? globalThis : window);
