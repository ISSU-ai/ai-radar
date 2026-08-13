'use strict';

/**
 * 회의록(050)과 인용 앵커.
 *
 * 순수 함수다 — DB 도 DOM 도 모른다. 서버·목업·검사가 같은 규칙을 쓴다.
 *
 * ⚠ **원문을 요약하지 않는다.** 여기 있는 것은 목록에 보일 머리말을 만드는 일뿐이고,
 *   본문은 손대지 않는다. 요약하는 순간 고객의 말이 영업의 말이 된다.
 *
 * ⚠ **인용에는 출처가 반드시 따라붙는다.** quote 만 남기면 "어느 미팅에서 나온
 *   말인가"를 못 되짚고, 그러면 인용이 있으나 마나다. note_id 와 met_on 이 없는 인용은
 *   만들지 않는다.
 *
 * ⚠ **인용을 원문 참조로 두지 않고 복사한다.** 원문이 나중에 고쳐지면 근거가 조용히
 *   바뀌기 때문이다. 복사해 두면 「그때 이렇게 말했다」가 남는다.
 */

const NOTE_KINDS = Object.freeze([
  ['meeting', '미팅'], ['call', '통화'], ['mail', '메일'], ['visit', '방문']
]);

const kindLabel = (value) => (NOTE_KINDS.find(([key]) => key === value) || [])[1] || '미팅';

/** 목록에 보일 만큼만. 본문 전량은 상세에서 따로 부른다 — 다섯 건이면 수만 자다. */
const PREVIEW_LENGTH = 120;
/** 인용 상한. 문단 하나 정도. 넘어가면 원문을 통째로 옮기는 것이고 그건 발췌가 아니다. */
const QUOTE_LIMIT = 400;

const text = (value) => (value === null || value === undefined ? '' : String(value));

/** 줄바꿈·연속 공백을 한 칸으로. **본문이 아니라 미리보기에만 쓴다.** */
const flatten = (value) => text(value).replace(/\s+/g, ' ').trim();

/**
 * 목록용 머리말. body 를 빼고 preview 만 남긴다 —
 * 라우트가 실수로 본문을 실어 보내지 않도록 **여기서 모양을 정한다.**
 */
function noteSummary(row) {
  const body = text(row?.body);
  const preview = flatten(body);
  return {
    id: row?.id,
    met_on: row?.met_on || '',
    kind: row?.kind || 'meeting',
    kind_label: kindLabel(row?.kind),
    title: text(row?.title),
    preview: preview.length > PREVIEW_LENGTH ? `${preview.slice(0, PREVIEW_LENGTH)}…` : preview,
    length: body.length,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null
  };
}

/** 최신 미팅이 위. 같은 날이면 나중에 적은 것이 위. */
function sortNotes(rows) {
  return (Array.isArray(rows) ? [...rows] : []).sort((a, b) =>
    String(b?.met_on || '').localeCompare(String(a?.met_on || ''))
    || String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
}

/**
 * 발췌를 인용 앵커로 만든다. **출처가 없으면 만들지 않는다.**
 * 되짚을 수 없는 인용은 근거가 아니라 그냥 옮겨 적은 문장이다.
 */
function buildQuote(selection, note) {
  const quote = flatten(selection);
  if (!quote || !note?.id || !note?.met_on) return null;
  return {
    quote: quote.length > QUOTE_LIMIT ? `${quote.slice(0, QUOTE_LIMIT)}…` : quote,
    note_id: note.id,
    met_on: note.met_on,
    note_title: text(note.title) || kindLabel(note.kind),
    // 나중에 LLM 추출을 얹을 때 여기만 'extracted' 로 는다. 저장 구조는 그대로다.
    source: 'human'
  };
}

/** 문서에 붙는 출처 한 줄. 화면과 문서가 같은 문장을 쓰게 한다. */
const quoteSource = (anchor) =>
  (anchor?.met_on ? `${anchor.met_on} ${text(anchor.note_title) || '회의록'}` : '');

/**
 * 저장된 값에서 유효한 앵커만 고른다. 회의록이 지워졌으면 인용은 남기되 **원문으로
 * 가는 길이 끊겼다는 것**을 표시한다 — 조용히 버리면 근거가 사라진 줄 모른다.
 */
function resolveQuote(anchor, notes) {
  if (!anchor?.quote) return null;
  const alive = (Array.isArray(notes) ? notes : []).some((n) => n?.id === anchor.note_id);
  return { ...anchor, orphan: !alive };
}

module.exports = {
  NOTE_KINDS, PREVIEW_LENGTH, QUOTE_LIMIT,
  kindLabel, noteSummary, sortNotes, buildQuote, quoteSource, resolveQuote
};
