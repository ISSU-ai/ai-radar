'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  noteSummary, sortNotes, buildQuote, quoteSource, resolveQuote, kindLabel, QUOTE_LIMIT
} = require('../lib/meeting-notes');
const { validateMeetingNote, EDITABLE_DEAL_FIELDS } = require('../lib/hub-domain');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const NOTE = { id: 'n1', met_on: '2026-08-14', kind: 'meeting', title: '킥오프' };

test('본문을 다듬지 않는다 — 줄바꿈과 들여쓰기가 그대로다', () => {
  // 여기서 정규화하면 나중에 발췌한 인용이 원문과 안 맞는다.
  const note = validateMeetingNote({
    met_on: '2026-08-14', body: '  법무팀은\n    수작업으로 합니다.  '
  });
  assert.equal(note.body, '법무팀은\n    수작업으로 합니다.');
});

test('미팅 일자가 없거나 실제 날짜가 아니면 저장하지 않는다', () => {
  // 잘못 들어간 날짜는 되짚을 때 거짓말을 한다.
  assert.throws(() => validateMeetingNote({ body: 'x' }), /YYYY-MM-DD/);
  assert.throws(() => validateMeetingNote({ met_on: '2026-02-30', body: 'x' }), /실제 날짜/);
  assert.throws(() => validateMeetingNote({ met_on: '2026-08-14', body: '   ' }), /입력해주세요/);
  assert.throws(() => validateMeetingNote({ met_on: '2026-08-14', kind: 'sms', body: 'x' }), /종류/);
});

test('참석자 칸을 만들지 않는다', () => {
  // 만드는 순간 개인정보 「수집」이 되고 고지 대상이 된다.
  const note = validateMeetingNote({
    met_on: '2026-08-14', body: 'x', attendees: '김고객, 박담당', contact_name: '김고객'
  });
  assert.deepEqual(Object.keys(note).sort(), ['body', 'kind', 'met_on', 'title']);
  const sql = read('db/migrations/050_meeting_notes.sql');
  const ddl = sql.slice(sql.indexOf('create table'), sql.indexOf('comment on table'));
  for (const column of ['attendee', 'contact_name', 'contact_email', 'phone']) {
    assert.ok(!ddl.includes(column), `${column} 칸이 생기면 개인정보 수집이 된다`);
  }
});

test('목록 머리말에 본문이 없다', () => {
  // 회의록 다섯 건이면 응답이 수만 자가 된다.
  const summary = noteSummary({ ...NOTE, body: 'ㄱ'.repeat(5000), created_at: '2026-08-14T00:00:00Z' });
  assert.ok(!('body' in summary), 'body 가 목록에 실렸다');
  assert.equal(summary.length, 5000, '길이는 알려준다');
  assert.ok(summary.preview.length <= 121, summary.preview);
  assert.equal(summary.kind_label, '미팅');
});

test('미리보기만 줄바꿈을 접는다', () => {
  const summary = noteSummary({ ...NOTE, body: '첫 줄\n\n  둘째 줄' });
  assert.equal(summary.preview, '첫 줄 둘째 줄');
});

test('최신 미팅이 위에 온다', () => {
  const sorted = sortNotes([
    { id: 'a', met_on: '2026-08-07' }, { id: 'b', met_on: '2026-08-14' }, { id: 'c', met_on: '2026-07-30' }
  ]);
  assert.deepEqual(sorted.map((n) => n.id), ['b', 'a', 'c']);
});

test('출처가 없는 인용은 만들지 않는다', () => {
  // 되짚을 수 없는 인용은 근거가 아니라 그냥 옮겨 적은 문장이다.
  assert.equal(buildQuote('법무팀은 수작업입니다', { id: 'n1' }), null, 'met_on 이 없다');
  assert.equal(buildQuote('법무팀은 수작업입니다', { met_on: '2026-08-14' }), null, 'note_id 가 없다');
  assert.equal(buildQuote('   ', NOTE), null, '빈 발췌');
});

test('인용에 note_id 와 met_on 이 반드시 따라붙는다', () => {
  const anchor = buildQuote('법무팀은\n  수작업으로 합니다', NOTE);
  assert.equal(anchor.quote, '법무팀은 수작업으로 합니다');
  assert.equal(anchor.note_id, 'n1');
  assert.equal(anchor.met_on, '2026-08-14');
  assert.equal(anchor.note_title, '킥오프');
  // 나중에 LLM 추출을 얹을 때 여기만 'extracted' 로 는다.
  assert.equal(anchor.source, 'human');
  assert.equal(quoteSource(anchor), '2026-08-14 킥오프');
});

test('발췌가 원문 통째면 자른다', () => {
  const anchor = buildQuote('가'.repeat(QUOTE_LIMIT + 200), NOTE);
  assert.ok(anchor.quote.length <= QUOTE_LIMIT + 1, '상한을 넘으면 발췌가 아니라 복사다');
  assert.ok(anchor.quote.endsWith('…'));
});

test('회의록이 지워지면 인용을 버리지 않고 끊겼다고 표시한다', () => {
  // 조용히 버리면 근거가 사라진 줄 모른다.
  const anchor = buildQuote('법무팀은 수작업입니다', NOTE);
  assert.equal(resolveQuote(anchor, [{ id: 'n1' }]).orphan, false);
  assert.equal(resolveQuote(anchor, []).orphan, true);
  assert.equal(resolveQuote(anchor, []).quote, '법무팀은 수작업입니다', '인용은 남는다');
});

test('고객 문서가 회의록을 안 부른다', () => {
  // 「지우는 게 아니라 안 부른다」 — 소스에 이름이 아예 없어야 한다.
  const hub = read('hub.js');
  const kit = hub.slice(hub.indexOf('function buildCustomerKit'), hub.indexOf('const STAGE_REPORT_TITLES'));
  const code = kit.split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
  // ⚠ 'quote' 만으로 찾으면 가견적(computeQuote)에 걸린다. 인용 앵커만 가리키게 좁힌다.
  for (const name of ['meeting_notes', 'state.notes', 'noteDraft', 'note_id', 'quoteSource', 'resolveQuote']) {
    assert.ok(!code.includes(name), `고객용 키트가 ${name} 를 읽는다`);
  }
});

test('두 메모 칸이 다른 저장소이고 화면이 그것을 말한다', () => {
  const hub = read('hub.js');
  // customer_meta.notes 는 고객에게 그대로 나간다 — 화면이 경고해야 섞이지 않는다.
  const at = hub.indexOf('for="deal-notes"');
  const intake = hub.slice(at, at + 900);
  assert.match(intake, /고객에게 그대로/, '고객용이라는 표시가 없다');
  assert.match(read('hub.html'), /내부용입니다/, '회의록 창에 내부용 표시가 없다');
  // 저장소가 다르다 — 회의록은 meta 가 아니다.
  assert.ok(!hub.includes("data-meta-field=\"meetingNotes\""), '회의록이 customer_meta 로 들어간다');
});

test('딜을 지우면 회의록도 지운다', () => {
  // 딜은 soft delete 라 cascade 가 안 걸린다. 아무 화면에도 안 보이는 행에
  // 고객 대화를 영구 보관하는 쪽이 더 나쁘다.
  assert.match(read('routes/hub.js'), /delete from meeting_notes where deal_id/);
  assert.match(read('scripts/mock-ui-server.js'), /mockNotes\.splice\(i, 1\)/);
});

test('표가 없어도 딜 상세가 안 깨진다', () => {
  const routes = read('routes/hub.js');
  // 050 은 컬럼이 아니라 표라 to_regclass 로 본다.
  assert.match(routes, /to_regclass\('public\.meeting_notes'\)/);
  assert.match(routes, /hasMeetingNotes\(\)/);
  // 화면도 실패를 삼킨다 — 503 이 와도 딜은 열려야 한다.
  const hub = read('hub.js');
  const loader = hub.slice(hub.indexOf('async function loadNotes'), hub.indexOf('function renderNotesSummary'));
  assert.match(loader, /catch \(error\)/);
});

test('회의록은 딜 목록에 실리지 않는다', () => {
  const routes = read('routes/hub.js');
  const list = routes.slice(routes.indexOf("router.get('/deals'"), routes.indexOf("router.get('/deals/:id'"));
  const code = list.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!code.includes('meeting_notes'), '목록은 owner 게이트가 없다');
});

test('회의록은 딜 편집 허용목록에 없다', () => {
  for (const field of ['meeting_notes', 'notes', 'handoff']) {
    assert.ok(!EDITABLE_DEAL_FIELDS.includes(field), `${field} 가 PATCH 로 새어 들어간다`);
  }
});

test('kind 어휘가 SQL 제약과 같다', () => {
  const sql = read('db/migrations/050_meeting_notes.sql');
  for (const [value, label] of [['meeting', '미팅'], ['call', '통화'], ['mail', '메일'], ['visit', '방문']]) {
    assert.ok(sql.includes(`'${value}'`), `SQL 에 ${value} 가 없다`);
    assert.equal(kindLabel(value), label);
    // 화면도 같은 목록을 쓴다 — 갈리면 저장이 400 으로 튕긴다.
    assert.ok(read('hub.js').includes(`['${value}', '${label}']`), `화면 목록에 ${value} 가 없다`);
  }
});
