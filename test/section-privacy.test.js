'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  splitSectionText,
  stripInternalSections,
  extractInternalSections,
  findResidueLines
} = require('../lib/section-privacy');

const OPENAI_SECTION_1 = [
  '- **차별적 비즈니스 가치 (5가지)**:',
  '  - ① 최강의 범용 추론 성능: 복잡한 데이터 분석 자동화',
  '  - ⑤ 강력한 관리자 통제: SSO 연동, 도메인 인증',
  '- **AI Tech 의견 (PreSales)**: API 유연성은 압도적이나 MZC의 재판매 마진은 거의 제로에 가깝습니다.(리셀러 계약 추진)',
  '[의견] 단독 공급은 피하고 MZC 기술 SI를 결합해야만 유의미한 비즈니스 마진 확보가 가능합니다.'
].join('\n');

test('§1 의 PreSales 의견 불릿과 뒤따르는 [의견] 문단을 내부로 가른다', () => {
  const { publicText, internalText } = splitSectionText(OPENAI_SECTION_1);

  assert.ok(publicText.includes('강력한 관리자 통제'), '공개 카피는 남아야 한다');
  assert.ok(!publicText.includes('마진'), '공개 본문에 마진 언급이 남으면 안 된다');
  assert.ok(!publicText.includes('리셀러'));
  assert.ok(!publicText.includes('[의견]'));

  assert.ok(internalText.includes('재판매 마진'));
  assert.ok(internalText.includes('[의견] 단독 공급은 피하고'));
});

test('§8 의 마진 확보 전략 불릿을 내부로 가르고 공개 FAQ 는 남긴다', () => {
  const section8 = [
    '- **마진 확보 전략**: 단순 라이센스 리셀은 마진이 작습니다. RAG 패키지를 묶어 딜 사이즈를 3배로 키우십시오.',
    '- **Q1. 한국어 성능은 어떤가요?**',
    '  - A: 토크나이저 효율화로 한국어 인지력이 향상되었습니다.'
  ].join('\n');

  const { publicText, internalText } = splitSectionText(section8);

  assert.ok(publicText.includes('한국어 성능'));
  assert.ok(!publicText.includes('마진'));
  assert.ok(!publicText.includes('딜 사이즈'));
  assert.ok(internalText.includes('마진 확보 전략'));
});

test('내부 마커가 없는 본문은 그대로 통과한다', () => {
  const plain = '- **제품 라인업**: ChatGPT Enterprise\n- **핵심 모델**: GPT-5.5';
  const { publicText, internalText } = splitSectionText(plain);
  assert.strictEqual(publicText, plain);
  assert.strictEqual(internalText, '');
});

test('stripInternalSections 는 멱등이다 (이미 분리된 본문을 또 깎지 않는다)', () => {
  const once = stripInternalSections({ 1: OPENAI_SECTION_1 });
  const twice = stripInternalSections(once);
  assert.deepStrictEqual(twice, once);
});

test('extractInternalSections 는 내용이 있는 섹션만 담는다', () => {
  const internal = extractInternalSections({ 1: OPENAI_SECTION_1, 2: '- **매핑**: L1' });
  assert.deepStrictEqual(Object.keys(internal), ['1']);
});

test('문자열 jsonb 도 받아들인다', () => {
  const stripped = stripInternalSections(JSON.stringify({ 1: OPENAI_SECTION_1 }));
  assert.ok(!stripped['1'].includes('마진'));
});

test('실제 시드 데이터 18건 전부에서 공개 본문에 위험 키워드가 남지 않는다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'isv_data.js'), 'utf8');
  // eslint-disable-next-line no-eval
  const isvData = eval(`${source}; isvData`);

  assert.strictEqual(isvData.length, 18, '시드 건수가 바뀌면 이 테스트를 갱신할 것');

  let movedPairs = 0;
  for (const solution of isvData) {
    const publicSections = stripInternalSections(solution.sections);
    movedPairs += Object.keys(extractInternalSections(solution.sections)).length;

    for (const [key, text] of Object.entries(publicSections)) {
      assert.deepStrictEqual(
        findResidueLines(text),
        [],
        `${solution.name} §${key} 공개 본문에 내부 키워드가 남았다`
      );
      const original = String((solution.sections || {})[key] || '');
      if (original.trim()) {
        assert.notStrictEqual(text.trim(), '', `${solution.name} §${key} 공개 본문이 통째로 사라졌다`);
      }
    }
  }

  assert.strictEqual(movedPairs, 35, '§1 18건 + §8 17건 = 35개 조합이 내부로 이동해야 한다');
});
