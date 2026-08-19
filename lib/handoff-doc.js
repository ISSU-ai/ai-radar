'use strict';

/**
 * 인계 산출물 (Phase 4·5·6).
 *
 * 순수 함수다 — DB 도 DOM 도 모른다. **문서를 스냅샷의 뷰로 만든다.** deployment-Brief 의
 * evidence_item 규격이 굳으면 key 매핑만 고치고 문서는 안 건드린다.
 *
 * 세 산출물이 나온다.
 *   ① 인계 브리프   Deployment Brief §A 14필드 + §B 근거표
 *   ② 인터뷰 가이드  못 채운 칸을 질문으로 (문서1 §10)
 *   ③ 근거 격차 요약 7 준비도 영역 양호/주의/미흡 (문서1 §A)
 * 그리고 추진 방식 **권고**(§G)와 스냅샷 JSON.
 *
 * ⚠ **빈칸을 채우지 않는다.** 못 채운 칸은 「미해결」로 그대로 두고 질문으로 바꾼다.
 *   배포팀이 그럴듯한 가짜를 근거로 설계하는 것이 이 시스템이 가장 피하는 실패다.
 *
 * ⚠ **내부용이다.** 그래도 마진·단가·상업 전략은 안 부른다 — 구축 담당이 쓸 일이 없다.
 *   포탈 원본 연락처도 안 싣는다(027).
 *
 * ⚠ **추진 방식을 자동으로 확정하지 않는다.** 문서가 「의사결정 책임자」를 요구하고,
 *   시스템이 판정하면 그 판정의 근거를 아무도 못 따진다. 권고와 이유까지다.
 */

/**
 * ⚠ 화면(hub.js)과 서버·검사가 **같은 파일**을 쓴다. 문서 규칙을 두 곳에 적으면
 *   갈리고, 갈리면 영업이 보는 문서와 검사가 보는 문서가 달라진다. taxonomy.js 와
 *   같은 UMD 로 감싸 브라우저에서는 window.IssuHandoff 로 쓴다.
 */
(function wrap(global) {
const req = (typeof require === 'function' && typeof module !== 'undefined') ? require : null;
const { HANDOFF_FIELDS, QUALITY_CHECKS, CONSTRAINTS, qualityLabel, impactLabel,
  handoffReadiness, interviewQuestions, qualityGaps } = req ? req('./handoff-fields') : global.IssuHandoffFields;
const { STATUS_LABEL } = req ? req('./handoff-snapshot') : global.IssuHandoffSnapshot;
const { quoteSource } = req ? req('./meeting-notes') : global.IssuMeetingNotes;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const text = (value) => (value === null || value === undefined ? '' : String(value));
const filled = (value) => text(value).trim() !== '';
const fieldOf = (handoff, key) => asObject(asObject(handoff)[key]);
const valueOf = (handoff, key) => text(fieldOf(handoff, key).value).trim();

/** 문서 §B 상태 표기. handoff-snapshot 과 같은 어휘를 쓴다 — 두 문서가 나란히 놓인다. */
const CONFIRMED = 'confirmed';
const LIKELY = 'likely';
const OPEN = 'open';
const UNKNOWN = 'unknown';

/**
 * Deployment Brief §A 14필드. `from` 은 값을 어디서 끌어오는지다.
 *
 * ⚠ 12(관찰 체계)는 **여기서 안 받는다.** deployment-Brief §C 자리라 두 번 만들지
 *   않는다. 항상 「미해결 · 배포 단계에서 정합니다」로 나간다 — 빈칸을 숨기지 않는다.
 */
const BRIEF_SECTIONS = Object.freeze([
  Object.freeze({ no: 1, title: '배포 문제 정의', from: 'problem' }),
  Object.freeze({ no: 2, title: '초기 사용자 그룹', from: 'pilotGroup' }),
  Object.freeze({ no: 3, title: '비즈니스 성과 책임자', from: 'stakeholders' }),
  Object.freeze({ no: 4, title: 'ChatGPT 지원 워크플로', from: 'workflow' }),
  Object.freeze({ no: 5, title: '제품 경험 및 통제 의존성', from: 'controls' }),
  Object.freeze({ no: 6, title: '성공 기준', from: 'successCriteria' }),
  Object.freeze({ no: 7, title: '이해관계자 정렬', from: 'stakeholders' }),
  Object.freeze({ no: 8, title: '범위 경계', from: 'scope' }),
  Object.freeze({ no: 9, title: '사용 사례 품질 점검', from: 'quality' }),
  Object.freeze({ no: 10, title: '롤아웃 가정', from: 'assumptions' }),
  Object.freeze({ no: 11, title: '초기 추진 방식 권고', from: 'recommendation' }),
  Object.freeze({ no: 12, title: '관찰 체계 및 검토 책임', from: 'deferred' }),
  Object.freeze({ no: 13, title: '미해결 리스크', from: 'risks' }),
  Object.freeze({ no: 14, title: '즉시 다음 단계', from: 'nextSteps' })
]);

/**
 * 문서1 §A 「근거 품질 요약」 7 준비도 영역.
 *
 * ⚠ 42문항이 실제로 덮는 것은 **거버넌스와 기술 둘뿐**이다. 42문항은 「이 회사가 AI 를
 *   할 준비가 됐나」(조직 성숙도)를 묻고, 인계는 「이 프로젝트를 시작할 수 있나」(딜
 *   근거)를 묻는다 — 다른 질문이다. 그래서 나머지 다섯은 STEP06 칸이 있어야 찬다.
 */
const READINESS_AREAS = Object.freeze([
  Object.freeze({ key: 'opportunity', label: '영업 기회 정의' }),
  Object.freeze({ key: 'workflow', label: '워크플로 및 사용자' }),
  Object.freeze({ key: 'value', label: '가치 및 성공 근거' }),
  Object.freeze({ key: 'stakeholders', label: '이해관계자 책임 체계' }),
  Object.freeze({ key: 'product', label: '제품 및 데이터 맥락' }),
  Object.freeze({ key: 'governance', label: '거버넌스 및 통제' }),
  Object.freeze({ key: 'technical', label: '기술 · 워크스페이스 준비도' })
]);

const AREA_LEVELS = Object.freeze([['good', '양호'], ['watch', '주의'], ['weak', '미흡']]);
/** 근거 둘이면 양호, 하나면 주의, 없으면 미흡. 사람이 눈으로 매기면 딜마다 기준이 달라진다. */
const gradeOf = (count) => (count >= 2 ? 'good' : count === 1 ? 'watch' : 'weak');
const gradeLabel = (level) => (AREA_LEVELS.find(([key]) => key === level) || [])[1] || '';

/** Kit §7 에서 영업이 체크한 제약의 이름들. */
function constraintLabels(handoff) {
  const picked = new Set(asArray(asObject(handoff).constraints));
  return CONSTRAINTS.filter((c) => picked.has(c.key)).map((c) => c.label);
}

/** 42문항 축에 응답이 있는가. 조직 성숙도를 「아는가」이지 점수가 높은가가 아니다. */
function axisAnswered(scores, axis) {
  const source = asObject(scores);
  return Object.keys(source).some((code) => code.startsWith(axis) && filled(source[code]));
}

/**
 * 7영역 근거 격차. 각 영역이 **무엇 때문에** 그 판정인지 같이 낸다 —
 * 등급만 주면 무엇을 채워야 하는지 모른다.
 */
function evidenceAreas({ deal = {}, handoff = {} } = {}) {
  const meta = asObject(deal.customer_meta);
  const scores = deal.readiness_scores;
  const has = (label, ok) => (ok ? label : null);
  const pack = (area, items) => {
    const have = items.filter(Boolean);
    return { ...area, level: gradeOf(have.length), levelLabel: gradeLabel(gradeOf(have.length)), have };
  };
  return [
    pack(READINESS_AREAS[0], [
      has('고객이 남긴 상담 원문', filled(deal.lead_message)),
      has('우선 워크플로 정의', filled(valueOf(handoff, 'workflow')))
    ]),
    pack(READINESS_AREAS[1], [
      has('우선 워크플로 정의', filled(valueOf(handoff, 'workflow'))),
      has('초기 사용자 그룹', filled(valueOf(handoff, 'pilotGroup')))
    ]),
    pack(READINESS_AREAS[2], [
      has('성공 기준', filled(valueOf(handoff, 'successCriteria'))),
      has('범위 경계', filled(valueOf(handoff, 'scope')))
    ]),
    pack(READINESS_AREAS[3], [
      has('이해관계자 3역할', filled(valueOf(handoff, 'stakeholders'))),
      has('영업이 확인한 담당자', filled(deal.customer_contact_name))
    ]),
    pack(READINESS_AREAS[4], [
      has('42문항 데이터 기반(D) 응답', axisAnswered(scores, 'D')),
      has('고객이 문의한 제품', asArray(deal.inquiry_products).length > 0)
    ]),
    // 42문항이 실제로 덮는 두 영역.
    pack(READINESS_AREAS[5], [
      has('42문항 신뢰·안전(G) 응답', axisAnswered(scores, 'G')),
      has('보안 게이트웨이 확인', filled(meta.securityStack))
    ]),
    pack(READINESS_AREAS[6], [
      has('42문항 시스템·인프라(T) 응답', axisAnswered(scores, 'T')),
      has('조직 규모·도입 대상', filled(meta.companySize) || filled(meta.targetUsers))
    ])
  ];
}

/**
 * 추진 방식 **권고** (문서2 §G). 자동으로 정하지 않는다.
 *
 * 필수 근거 여섯 — 워크플로 · 초기 사용자 · 성과 책임자 · 성공 기준 · 거버넌스 경로 ·
 * 다음 단계. 잠정 기준이고 영업 리더 확정 전이라 **여기 한 곳만 고치면 된다.**
 */
const APPROACHES = Object.freeze({
  proceed: { key: 'proceed', label: 'Proceed (진행)', when: '핵심 근거와 책임 체계가 확인됐고 남은 공백이 계획을 막지 않습니다.' },
  validate: { key: 'validate', label: 'Focused Validation (집중 검증)', when: '유망하지만 한두 가지 핵심 불확실성을 먼저 검증해야 합니다.' },
  rescope: { key: 'rescope', label: 'Targeted Re-scope (범위 재조정)', when: '기회는 유효하지만 현재 범위가 넓거나 리스크가 높습니다.' },
  defer: { key: 'defer', label: 'No-go / Defer (연기)', when: '필수 근거·책임자·승인이 아직 확보되지 않았습니다.' }
});

const REQUIRED_EVIDENCE = Object.freeze([
  ['workflow', '우선 워크플로'],
  ['pilotGroup', '초기 사용자 그룹'],
  ['stakeholders', '성과 책임자'],
  ['successCriteria', '성공 기준'],
  ['__governance', '거버넌스 경로'],
  ['nextSteps', '즉시 다음 단계']
]);

function recommendApproach({ deal = {}, handoff = {} } = {}) {
  const meta = asObject(deal.customer_meta);
  const governance = axisAnswered(deal.readiness_scores, 'G') || filled(meta.securityStack);
  const have = [];
  const missing = [];
  for (const [key, label] of REQUIRED_EVIDENCE) {
    const ok = key === '__governance' ? governance : filled(valueOf(handoff, key));
    (ok ? have : missing).push(label);
  }
  const unmet = qualityGaps(handoff).filter((gap) => gap.level === 'unmet');

  let approach;
  const why = [];
  if (unmet.length) {
    approach = APPROACHES.rescope;
    why.push(`사용 사례 품질에서 미충족이 ${unmet.length}건입니다 — ${unmet.map((g) => g.label).join(' · ')}.`);
  } else if (have.length === REQUIRED_EVIDENCE.length) {
    approach = APPROACHES.proceed;
    why.push('필수 근거 여섯이 모두 확인됐습니다.');
  } else if (have.length >= 4) {
    approach = APPROACHES.validate;
    why.push(`필수 근거 ${have.length}/6 입니다. 남은 것이 특정돼 있어 시간 제한 검증으로 좁힐 수 있습니다.`);
  } else {
    approach = APPROACHES.defer;
    why.push(`필수 근거가 ${have.length}/6 입니다. 배포 계획을 시작할 근거가 아직 부족합니다.`);
  }
  if (missing.length) why.push(`아직 없는 것 — ${missing.join(' · ')}.`);
  const partial = qualityGaps(handoff).filter((gap) => gap.level === 'partial');
  if (partial.length) why.push(`부분 충족 — ${partial.map((g) => g.label).join(' · ')}.`);

  return { ...approach, have, missing, why, required: REQUIRED_EVIDENCE.length };
}

/* ── 문서 ────────────────────────────────────────────────────────────────── */

const block = (title, body) => `\n## ${title}\n\n${body}`;
const bullet = (list) => asArray(list).filter(Boolean).map((line) => `- ${line}`).join('\n');

/** 한 절의 값과 상태. 값이 없으면 **비운 채로** 상태만 남긴다. */
function briefEntry(section, ctx) {
  const { deal, handoff, openItems, recommendation, notes } = ctx;
  const meta = asObject(deal.customer_meta);
  const direct = (key) => {
    const entry = fieldOf(handoff, key);
    const value = text(entry.value).trim();
    const anchor = asObject(entry.quote);
    return {
      value,
      status: value ? LIKELY : OPEN,
      source: anchor.note_id ? quoteSource(anchor) : (value ? '영업 입력' : ''),
      quote: anchor.quote || '',
      orphan: Boolean(anchor.note_id) && !asArray(notes).some((n) => n.id === anchor.note_id)
    };
  };

  switch (section.from) {
    case 'problem': {
      // Kit §1 은 「왜 지금인가」를 따로 묻는다 — 배포팀이 급한 이유를 알아야 일정을 짠다.
      const why = valueOf(handoff, 'whyNow');
      const lines = [deal.lead_message, valueOf(handoff, 'workflow'),
        why ? `**왜 지금** ${why}` : ''].filter(Boolean);
      return { value: lines.join('\n\n'), status: lines.length ? LIKELY : OPEN,
        source: deal.lead_message ? '고객 상담 원문 + 영업 입력' : '영업 입력' };
    }
    case 'controls': {
      const lines = [
        meta.securityStack ? `보안 게이트웨이 — ${meta.securityStack}` : '',
        axisAnswered(deal.readiness_scores, 'G') ? '42문항 신뢰·안전(G) 응답 있음' : '',
        axisAnswered(deal.readiness_scores, 'T') ? '42문항 시스템·인프라(T) 응답 있음' : '',
        asArray(deal.inquiry_products).length ? `고객 문의 제품 ${asArray(deal.inquiry_products).length}종` : ''
      ].filter(Boolean);
      // 고객이 직접 답한 42문항이 근거다 — 영업이 고친 것은 스냅샷이 따로 가른다.
      return { value: bullet(lines), status: lines.length ? CONFIRMED : OPEN, source: '42문항 · 인테이크' };
    }
    case 'quality': {
      const checks = asObject(asObject(handoff).quality);
      const lines = QUALITY_CHECKS
        .filter((check) => checks[check.key])
        .map((check) => `${check.label} — **${qualityLabel(checks[check.key])}**`);
      return { value: bullet(lines), status: lines.length ? LIKELY : OPEN, source: '영업 판정 (Brief §F)' };
    }
    case 'assumptions': {
      // 가정 = 시스템이 모으는 미확인 항목 + 영업이 확인한 제약(Kit §7)
      const named = constraintLabels(handoff).map((label) => `${label} — 제약으로 확인됨`);
      const all = asArray(openItems).concat(named);
      return { value: all.length ? bullet(all) : '', status: OPEN,
        source: named.length ? '미확인 항목 + 영업 확인 제약' : '시스템이 모으는 미확인 항목' };
    }
    case 'risks': {
      // 영업이 적은 리스크가 먼저다 — 사람이 판단한 것이고, 나머지는 시스템이 센 것이다.
      const written = asArray(asObject(handoff).risks).map((row, i) =>
        `**R${i + 1}** ${row.text}${row.impact ? ` *(영향도 ${impactLabel(row.impact)})*` : ''}`);
      const gaps = qualityGaps(handoff).map((g) => `${g.label} — ${g.levelLabel}`);
      const all = written.concat(asArray(openItems), gaps);
      return { value: all.length ? bullet(all) : '', status: OPEN,
        source: written.length ? '영업 입력 + 미확인 항목' : '시스템이 모으는 미확인 항목' };
    }
    case 'recommendation':
      return { value: `**${recommendation.label}**\n\n${bullet(recommendation.why)}`,
        status: LIKELY, source: '근거 충족도로 계산한 권고 — 확정은 사람이 합니다' };
    case 'deferred':
      // deployment-Brief §C 자리다. 여기서 만들면 두 번 만든다.
      return { value: '', status: OPEN, source: '배포 단계에서 정합니다 (Deployment Brief §C)' };
    default:
      return direct(section.from);
  }
}

/**
 * 한 장 요약 — 원문이 말하는 **「간결한 배포 시작 문서」의 넷**이다.
 *   현재 확인된 사실 · 추가 검증이 필요한 사항 · 권장 초기 추진 방식 · 즉시 다음 단계
 *
 * ⚠ **새로 계산하지 않는다.** §A 항목의 상태와 recommendApproach 결과를 자리만 바꿔
 *   보인다. 두 번 계산하면 요약과 본문이 언젠가 갈리고, 그때 읽는 사람은 앞장을 믿는다.
 *
 * ⚠ 상태를 뭉치지 않는다. `가능성 높음`(영업이 넣은 값 — 재확인 대상)과 `미해결`
 *   (아무도 모름), `구분 불가`(원본이 없어 판정 자체가 안 됨)는 **다른 것**이다.
 *   한 숫자로 합치면 「검증 필요 7건」이 되고, 무엇을 해야 하는지가 사라진다.
 */
function briefSummary(sections, recommendation) {
  const CAP = 3;
  const names = (list) => (list.length > CAP
    ? `${list.slice(0, CAP).join(' · ')} 외 ${list.length - CAP}개`
    : list.join(' · '));
  const titlesOf = (status) => sections
    // ⚠ 11(권고)과 12(관찰 체계)는 근거가 아니다. 11 은 이 표의 셋째 줄 자체이고,
    //   12 는 배포 단계 자리다 — 공백이 아니라 경계다. 섞으면 「검증 필요」가 부풀고
    //   무엇을 확인해야 하는지가 흐려진다.
    .filter(({ section, entry }) => entry.status === status && (entry.value || status === OPEN)
      && section.from !== 'recommendation' && section.from !== 'deferred')
    .map(({ section }) => `${section.no}. ${section.title}`);

  const confirmed = titlesOf(CONFIRMED);

  /**
   * 「검증 필요」는 종류를 나눠 적는다. 재확인(`가능성 높음`)과 미확인(`미해결`)은
   * 할 일이 다르다.
   *
   * ⚠ 상태를 손으로 나열하지 않는다. **문서에 실제로 나온 상태를 전부 훑는다** —
   *   나열하면 나중에 상태가 하나 늘었을 때 요약에서만 조용히 빠진다. 순서를
   *   모르는 상태는 뒤에 붙여서라도 반드시 보이게 한다.
   */
  const ORDER = [LIKELY, OPEN, UNKNOWN];
  const rank = (status) => (ORDER.indexOf(status) < 0 ? ORDER.length : ORDER.indexOf(status));
  const needs = [...new Set(sections.map(({ entry }) => entry.status))]
    .filter((status) => status !== CONFIRMED)
    .sort((a, b) => rank(a) - rank(b))
    .map((status) => ({ status, list: titlesOf(status) }))
    .filter(({ list }) => list.length)
    .map(({ status, list }) => `\`${STATUS_LABEL[status] || status}\` ${list.length}항목`
      + `${status === LIKELY ? ' (영업 입력 — 재확인)' : ''} — ${names(list)}`)
    .join(' / ');

  const next = sections.find(({ section }) => section.no === 14);
  const nextValue = next && next.entry.value;

  return `| | |
|---|---|
| **현재 확인된 사실** | ${confirmed.length
    ? `\`${STATUS_LABEL[CONFIRMED]}\` ${confirmed.length}항목 — ${names(confirmed)}`
    : '_고객이 직접 낸 값이 아직 없습니다._'} |
| **추가 검증이 필요한 사항** | ${needs || '_없습니다._'} |
| **권장 초기 추진 방식** | **${recommendation.label}** — ${recommendation.why[0]} 확정은 의사결정 책임자가 합니다. |
| **즉시 수행해야 할 다음 단계** | ${nextValue || '_아직 정해지지 않았습니다 — 인터뷰 가이드의 마지막 질문입니다._'} |`;
}

/** ① 인계 브리프 — Deployment Brief §A + §B */
function buildBrief(ctx) {
  const { deal, handoff, today } = ctx;
  const recommendation = ctx.recommendation || recommendApproach(ctx);
  const sections = BRIEF_SECTIONS.map((section) => ({
    section, entry: briefEntry(section, { ...ctx, recommendation })
  }));

  const body = sections.map(({ section, entry }) => {
    const badge = `\`${STATUS_LABEL[entry.status]}\``;
    const where = entry.source ? ` · 출처 ${entry.source}` : '';
    const quote = entry.quote
      ? `\n\n  > ${entry.quote}${entry.orphan ? '\n  >\n  > *(원문 회의록이 삭제되어 되짚을 수 없습니다)*' : ''}`
      : '';
    return `### ${section.no}. ${section.title}\n\n${badge}${where}\n\n${entry.value || '_아직 확인되지 않았습니다._'}${quote}`;
  }).join('\n\n');

  const evidenceRows = sections
    .filter(({ entry }) => entry.value || entry.status === OPEN)
    .map(({ section, entry }) =>
      `| ${section.no}. ${section.title} | ${STATUS_LABEL[entry.status]} | ${entry.source || '—'} |`)
    .join('\n');

  const readiness = handoffReadiness(handoff);

  return `# ${deal.customer} — ChatGPT Deployment Brief (초안)

| | |
|---|---|
| 고객사 | ${deal.customer} |
| 작성일 | ${today} |
| 상태 | 초안 |
| 근거 충족 | ${readiness.filled} / ${readiness.total} 칸 (회의록 근거 ${readiness.sourced}칸) |

> [!기밀] **내부용** — 고객에게 그대로 전달하지 마세요.

> 이 문서는 전체 롤아웃 계획이 아닙니다. 배포 논의를 시작하기 위한 **최소 근거
> 패키지**입니다. 확인되지 않은 항목은 채우지 않고 그대로 비워 두었습니다 —
> 빈칸은 함께 딸린 인터뷰 가이드의 질문으로 이어집니다.
${block('한 장 요약', briefSummary(sections, recommendation))}
${block('A. Deployment Brief', body)}
${block('B. 근거 · 가정 · 미해결', `| 항목 | 상태 | 확인 출처 |\n|---|:--:|---|\n${evidenceRows}`)}

---

Assume nothing. Believe nothing. Confirm everything.
영업 인계 자료를 불신하라는 뜻이 아니라, 고객 약속을 뒷받침할 만큼 충분한 근거가
있는지 확인하라는 원칙입니다.`;
}

/** ② 인터뷰 가이드 — 문서1 §10. **이미 아는 것은 안 묻는다.** */
function buildInterviewGuide(ctx) {
  const { deal, handoff, openItems, today } = ctx;
  const questions = interviewQuestions(handoff);
  const gaps = qualityGaps(handoff);
  const areas = evidenceAreas(ctx).filter((area) => area.level !== 'good');

  const asked = questions.length
    ? questions.map((q, index) => `**Q${index + 1}. ${q.label}** *(Brief §A ${q.brief})*\n\n${q.question}`).join('\n\n')
    : '_여섯 칸이 모두 채워졌습니다. 아래 확인 항목만 짚으면 됩니다._';

  return `# ${deal.customer} — 인계 검토 인터뷰 가이드

| | |
|---|---|
| 작성일 | ${today} |
| 소요 | 30~45분 |

> [!기밀] **내부용** — 고객에게 그대로 전달하지 마세요.

> 이미 확인된 것은 묻지 않습니다. 아래 ${questions.length}개가 지금 비어 있는 칸입니다.
${block('먼저 물을 것', asked)}
${areas.length ? block('근거가 얇은 영역', bullet(areas.map((area) =>
    `**${area.label}** — ${area.levelLabel}${area.have.length ? ` (지금 있는 것: ${area.have.join(', ')})` : ' (근거 없음)'}`))) : ''}
${gaps.length ? block('품질 점검에서 걸린 것', bullet(gaps.map((gap) =>
    `**${gap.label}** — ${gap.levelLabel}. ${gap.question}`))) : ''}
${asArray(openItems).length ? block('시스템이 아직 모르는 것', bullet(openItems)) : ''}

---

확인된 사실이 아니라 아직 가정인 것은 무엇입니까?
실행 가능한 최소한의 다음 단계는 무엇입니까?`;
}

/** ③ 근거 격차 요약 — 문서1 §A 7영역 */
function buildEvidenceSummary(ctx) {
  const { deal, handoff, today } = ctx;
  const areas = evidenceAreas(ctx);
  const recommendation = ctx.recommendation || recommendApproach(ctx);
  const rows = areas.map((area) => {
    const mark = (level) => (area.level === level ? '☑' : '☐');
    return `| ${area.label} | ${mark('good')} | ${mark('watch')} | ${mark('weak')} | ${area.have.join(', ') || '—'} |`;
  }).join('\n');

  return `# ${deal.customer} — 근거 품질 요약

| | |
|---|---|
| 작성일 | ${today} |

> [!기밀] **내부용** — 고객에게 그대로 전달하지 마세요.
${block('준비도 영역', `| 영역 | 양호 | 주의 | 미흡 | 지금 있는 근거 |\n|---|:--:|:--:|:--:|---|\n${rows}`)}
${block('권장 추진 방식', `**${recommendation.label}**\n\n${recommendation.when}\n\n${bullet(recommendation.why)}\n\n> ⚠ 이것은 **권고**입니다. 근거 충족도로 계산한 값이고, 확정은 의사결정 책임자가 합니다.`)}

---

42문항 진단은 **조직의 AI 성숙도**를 묻고, 이 문서는 **이 프로젝트를 시작할 수 있는가**를
묻습니다. 다른 질문이라, 진단 점수가 높아도 근거가 얇을 수 있습니다.`;
}

/**
 * 스냅샷 (Phase 6) — deployment-Brief 접점.
 * 사람이 읽는 문서는 전부 이것의 뷰다. 그쪽 규격이 굳으면 key 매핑만 고친다.
 */
function buildHandoffExport(ctx) {
  const { deal, handoff, openItems, today } = ctx;
  const recommendation = ctx.recommendation || recommendApproach(ctx);
  return {
    schema: 'issu.handoff/1',
    generated_on: today,
    customer: deal.customer,
    confidentiality: 'internal',
    fields: BRIEF_SECTIONS.map((section) => {
      const entry = briefEntry(section, { ...ctx, recommendation });
      return {
        key: `brief_a_${section.no}`,
        label: section.title,
        value: entry.value,
        status: entry.status,
        source: entry.source || null,
        evidence: entry.quote || null
      };
    }),
    readiness: handoffReadiness(handoff),
    areas: evidenceAreas(ctx).map(({ key, label, level, have }) => ({ key, label, level, have })),
    quality: qualityGaps(handoff).map(({ key, label, level }) => ({ key, label, level })),
    open_items: asArray(openItems),
    recommendation: {
      key: recommendation.key, label: recommendation.label,
      have: recommendation.have, missing: recommendation.missing, why: recommendation.why
    }
  };
}

const api = {
  BRIEF_SECTIONS, READINESS_AREAS, AREA_LEVELS, APPROACHES, REQUIRED_EVIDENCE,
  constraintLabels,
  gradeLabel, axisAnswered, evidenceAreas, recommendApproach,
  buildBrief, buildInterviewGuide, buildEvidenceSummary, buildHandoffExport, briefSummary,
  HANDOFF_FIELDS
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.IssuHandoff = api;
})(typeof window === 'undefined' ? globalThis : window);
