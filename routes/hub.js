'use strict';

const express = require('express');
const {
  PIPELINE_STAGES,
  normaliseDealPatch,
  validateDealCreate,
  validateLead
} = require('../lib/hub-domain');

/** jsonb 컬럼이 null·잘못된 모양으로 와도 map/filter 가 터지지 않게 한다. */
const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * 041 이 심는 딜 컬럼. 컬럼이 아직 없는 구간에 저장 요청이 오면 503 으로 막는다 —
 * 그냥 UPDATE 하면 42703 으로 patch 전체가 실패해 같이 실린 메모·단계까지 날아간다.
 */
const PIPELINE_FIELDS_041 = new Set(['mzc_sales', 'msp_status', 'inquiry_date',
  'customer_contact_name', 'customer_contact_dept', 'customer_contact_title',
  'customer_contact_email', 'inquiry_products']);

const STALE_RATE_LIMIT_MS = 15 * 60 * 1000;
const PUBLIC_LEAD_LIMIT = 8;
/**
 * 접수 시점의 동의 내용. **화면 고지(readiness.html)와 한 글자도 어긋나면 안 된다.**
 *
 * 수집 항목을 늘릴 때는 version 을 올린다 — 옛 동의로 받은 건과 새 동의로 받은 건이
 * 섞이면 나중에 "이 사람은 무엇에 동의했나" 를 되찾을 수 없다.
 * v2: 직함·도입 시기 추가 (045)
 */
const PRIVACY_NOTICE = Object.freeze({
  version: '2026-08-13-v2',
  purpose: 'AI 준비도 진단 결과를 바탕으로 한 상담 접수, 담당자 연락 및 제안 준비',
  retention: '상담 요청일로부터 1년'
});

const { recommend } = require('../lib/recommendation-engine');
const { scoreReadiness } = require('../lib/readiness-scoring');
const { scoreAssessment, bridgeAssessmentScores, buildGapTotals } = require('../lib/assessment-scoring');
const { INTERNAL_BULLET_LABELS } = require('../lib/section-privacy');
const { sendLeadReceipt } = require('../lib/notify');
const { pickCaseStudies, caseContext } = require('../lib/case-match');

function createHubRouter({ pool, authenticateToken, adminOnly, auditLog, hasColumn }) {
  // 009 는 수동 적용이라 컬럼이 아직 없을 수 있다. 없으면 "미확정(true)"으로 본다 —
  // 모를 때 금액을 감추는 쪽이 견적서에 데모 단가가 인용되는 것보다 안전하다.
  const hasPriceFlag = async (table) => (hasColumn ? hasColumn(table, 'price_is_placeholder') : false);
  const router = express.Router();
  const leadAttempts = new Map();
  const eventStreams = new Set();
  let dealListener = null;
  let dealListenerPromise = null;
  let dealListenerRetry = null;
  let dealNotificationHandler = null;
  let dealListenerErrorHandler = null;

  /**
   * 화면이 고쳐야 할 대상을 알아야 하는 오류는 목록도 같이 내려보낸다.
   *
   * 미응답 42문항이 그렇다 — 개수만 알리면 어디인지 찾느라 이탈한다. `unanswered`
   * 를 떨어뜨렸더니 화면이 배너만 띄우고 문항으로 이동하지 못했다(목업은 내려보내서
   * 로컬에서만 정상으로 보였다).
   *
   * 메시지 밖의 필드는 **화이트리스트로만** 통과시킨다. 에러 객체를 통째로 직렬화하면
   * 스택·쿼리·컬럼명이 공개 응답에 섞인다.
   */
  /**
   * 삭제된 딜을 거르는 조건 조각.
   *
   * 041 미적용 구간에는 빈 문자열이 되어 조건이 빠진다 — 쿼리가 깨지는 것보다 낫다.
   * 딜을 읽거나 고치는 **모든** 쿼리에 붙여야 한다. 하나만 빠지면 지운 딜이 그
   * 경로에서만 되살아나는데 화면에는 티가 안 난다.
   */
  const liveDeal = async (alias = 'd') => (
    (hasColumn && await hasColumn('deals', 'deleted_at')) ? ` and ${alias}.deleted_at is null` : ''
  );

  const sendError = (res, error, status = 400) => {
    const message = error instanceof Error ? error.message : '요청을 처리할 수 없습니다.';
    const body = { error: message };
    if (Array.isArray(error?.unanswered)) body.unanswered = error.unanswered;
    return res.status(status).json(body);
  };

  const sendPublicUnavailable = (res, message = '준비도 진단 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.') => (
    res.status(503).json({ error: message })
  );

  const slackNotify = async (text) => {
    if (!process.env.SLACK_WEBHOOK_URL) return;
    try {
      const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!response.ok) console.error(`Slack notification failed: ${response.status}`);
    } catch (error) {
      console.error('Slack notification failed:', error.message);
    }
  };

  const checkPublicRateLimit = (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const active = (leadAttempts.get(key) || []).filter((stamp) => now - stamp < STALE_RATE_LIMIT_MS);
    if (active.length >= PUBLIC_LEAD_LIMIT) {
      return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });
    }
    active.push(now);
    leadAttempts.set(key, active);
    next();
  };


  const broadcastDealChange = (payload) => {
    for (const stream of eventStreams) {
      if (stream.destroyed || stream.writableEnded) {
        eventStreams.delete(stream);
        continue;
      }
      stream.write(`event: deal-change\ndata: ${payload || '{}'}\n\n`);
    }
  };

  const scheduleDealListener = () => {
    if (!eventStreams.size || dealListenerRetry) return;
    dealListenerRetry = setTimeout(() => {
      dealListenerRetry = null;
      void ensureDealListener();
    }, 2000);
    dealListenerRetry.unref?.();
  };

  const stopDealListener = async () => {
    if (dealListenerRetry) {
      clearTimeout(dealListenerRetry);
      dealListenerRetry = null;
    }
    const client = dealListener;
    dealListener = null;
    if (!client) return;
    if (dealNotificationHandler) client.removeListener('notification', dealNotificationHandler);
    if (dealListenerErrorHandler) client.removeListener('error', dealListenerErrorHandler);
    dealNotificationHandler = null;
    dealListenerErrorHandler = null;
    try { await client.query('unlisten deal_changes'); } catch (_error) { /* connection may already be closing */ }
    try { client.release(); } catch (_releaseError) { /* already removed */ }
  };

  const ensureDealListener = async () => {
    if (dealListener || dealListenerPromise || !eventStreams.size) return dealListenerPromise;
    dealListenerPromise = (async () => {
      let client;
      try {
        client = await pool.connect();
        const onNotification = (message) => broadcastDealChange(message.payload);
        const onError = (error) => {
          console.error('Deal event listener disconnected:', error.message);
          if (dealListener === client) dealListener = null;
          client.removeListener('notification', onNotification);
          client.removeListener('error', onError);
          dealNotificationHandler = null;
          dealListenerErrorHandler = null;
          try { client.release(true); } catch (_releaseError) { /* already removed */ }
          scheduleDealListener();
        };
        dealNotificationHandler = onNotification;
        dealListenerErrorHandler = onError;
        client.on('notification', onNotification);
        client.on('error', onError);
        await client.query('listen deal_changes');
        dealListener = client;
        if (!eventStreams.size) await stopDealListener();
      } catch (error) {
        if (client) {
          client.removeAllListeners('notification');
          client.removeAllListeners('error');
          try { client.release(true); } catch (_releaseError) { /* already removed */ }
        }
        dealNotificationHandler = null;
        dealListenerErrorHandler = null;
        console.error('Deal event listener failed:', error.message);
        scheduleDealListener();
      }
    })().finally(() => {
      dealListenerPromise = null;
    });
    return dealListenerPromise;
  };

  router.get('/public/tracks', async (_req, res) => {
    try {
      const result = await pool.query('select id, name, why from tracks order by id');
      res.json(result.rows);
    } catch (error) {
      console.error('Public tracks failed:', error.message);
      sendPublicUnavailable(res, '추천 트랙 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  });

  router.get('/public/packages', async (_req, res) => {
    try {
      const result = await pool.query(
        `select p.id, p.name, p.period, p.target,
                coalesce(json_agg(json_build_object('type', pi.type, 'label', pi.label)
                  order by pi.sort_order) filter (where pi.id is not null), '[]') as items
         from packages p left join package_items pi on pi.package_id = p.id
         where p.status = 'active'
         group by p.id order by p.sort_order`
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Public packages failed:', error.message);
      sendPublicUnavailable(res, '오퍼링 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  });

  // ── AI 준비도 42문항 (029) ──────────────────────────────────
  // 판정 기준(Appendix A 10평가영역)과 다른 층이다. 이쪽은 고객이 답하는 회사 수준
  // 진단이고, 저쪽은 "이 제품을 지금 넣을 수 있나" 게이트다. 섞지 않는다.
  const loadReadinessItems = async () => {
    if (!(hasColumn && await hasColumn('readiness_items', 'code'))) return null;
    const hasFix = hasColumn ? await hasColumn('readiness_items', 'fix') : false;
    const [areas, items] = await Promise.all([
      pool.query('select id, name, sort_order from readiness_areas order by sort_order'),
      // 043 미적용 구간에도 진단이 돌아야 한다. 컬럼이 없으면 빈 처방으로 내려보낸다.
      pool.query(`select code, area, seq, respondent, text, detail, rubric, target${hasFix ? ', fix' : ", null::text as fix"}
                    from readiness_items where status = 'active' order by area, seq`)
    ]);
    return { areas: areas.rows, items: items.rows };
  };

  /**
   * 기획안 Appendix A 10평가영역 (036) 과 42→10 bridge (037).
   *
   * 036 미적용 구간에는 null 로 간다 — 판정 없이 도는 것이 화면이 깨지는 것보다 낫다.
   */
  const loadAssessment = async () => {
    if (!(hasColumn && await hasColumn('assessment_areas', 'checkpoints'))) return null;
    const [domains, areas, bridge] = await Promise.all([
      pool.query('select id, name, sort_order from assessment_domains order by sort_order'),
      pool.query(`select id, domain_id, name, checkpoints, concerns, weight, threshold, sort_order
                    from assessment_areas where status = 'active' order by sort_order`),
      hasColumn('readiness_assessment_bridge', 'area_id')
        ? pool.query('select item_code, area_id, fidelity from readiness_assessment_bridge')
        : Promise.resolve({ rows: [] })
    ]);
    return { domains: domains.rows, areas: areas.rows, bridge: bridge.rows };
  };

  /**
   * 42문항 응답 → 평가영역 점수 → 집계.
   *
   * 8개가 차고 저장·보존·계정통제는 안 찬다 — 제품 설정이라 42문항이 묻지 않는다.
   * 영업이 STEP03 에서 후보별로 확인한다.
   *
   * 영업이 직접 확인한 값(manualScores)이 bridge 자동 채움을 이긴다. 순서가 뒤집히면
   * 확인해 고친 값을 진단 응답이 덮는다.
   */
  const applyAssessment = async (readinessScores, manualScores) => {
    const data = await loadAssessment();
    if (!data) return null;
    const bridged = bridgeAssessmentScores(data.bridge, readinessScores);
    const scores = { ...bridged, ...(manualScores || {}) };
    return {
      scores,
      totals: scoreAssessment(data.areas, data.domains, scores),
      bridged: Object.keys(bridged)
    };
  };

  const applyReadiness = async (readinessScores, options = {}) => {
    const data = await loadReadinessItems();
    if (!data) return null;
    return scoreReadiness(data.items, data.areas, readinessScores, options);
  };

  router.get('/public/readiness-items', async (_req, res) => {
    try {
      const data = await loadReadinessItems();
      if (!data) {
        return sendPublicUnavailable(res, '준비도 진단 문항이 아직 준비되지 않았습니다.');
      }
      res.json(data);
    } catch (error) {
      console.error('Readiness items failed:', error.message);
      sendPublicUnavailable(res, '준비도 진단 문항을 불러오지 못했습니다.');
    }
  });

  /**
   * 우선 개선 축을 다루는 패키지. 「그래서 우리가 뭘 하나」다.
   *
   * ⚠ 문항의 fix(고객이 할 일)와 **가른다.** 처방에 제품 이름을 섞으면 리포트가
   *   광고가 되고, 광고가 되면 처방도 같이 안 읽힌다. 처방을 먼저 보여주고 이건
   *   그 아래 따로 붙인다.
   *
   * 038 이 심은 packages.readiness_coverage 를 그대로 읽는다 — 6축을 전부 덮으므로
   * ISSU 가중치 검토(readiness_offering_weights)를 기다릴 필요가 없다.
   * 가격은 싣지 않는다. 공개 화면이고 단가는 아직 미정이다.
   */
  const coveringPackages = async (axes) => {
    if (!axes.length) return new Map();
    if (!(hasColumn && await hasColumn('packages', 'readiness_coverage'))) return new Map();
    const { rows } = await pool.query(
      `select id, name, target, readiness_coverage from packages
        where status = 'active' order by sort_order`
    );
    const byAxis = new Map(axes.map((axis) => [axis, []]));
    for (const row of rows) {
      for (const entry of asArray(row.readiness_coverage)) {
        const bucket = byAxis.get(entry?.axis);
        if (!bucket) continue;
        bucket.push({ id: row.id, name: row.name, target: row.target, strength: Number(entry.strength) || 0 });
      }
    }
    // 깊게 다루는 것부터. 두 개까지만 — 셋을 넘기면 고르라는 말이 아니라 목록이 된다.
    for (const [axis, list] of byAxis) {
      byAxis.set(axis, list.sort((a, b) => b.strength - a.strength).slice(0, 2));
    }
    return byAxis;
  };

  // 점수 계산. 저장하지 않는다 — 상담 요청은 별도 경로다.
  router.post('/public/readiness', async (req, res) => {
    try {
      const data = await loadReadinessItems();
      if (!data) {
        return sendPublicUnavailable(res, '준비도 진단 문항이 아직 준비되지 않았습니다.');
      }
      const result = scoreReadiness(data.items, data.areas, req.body?.scores);
      const covering = await coveringPackages(asArray(result.priorities).map((p) => p.area));
      result.priorities = asArray(result.priorities)
        .map((p) => ({ ...p, offerings: covering.get(p.area) || [] }));
      res.json(result);
    } catch (error) {
      if (error?.expected) return sendError(res, error);
      console.error('Readiness scoring failed:', error.message);
      sendPublicUnavailable(res, '준비도 결과를 계산하지 못했습니다.');
    }
  });

  /**
   * 딜에 붙일 레퍼런스. 업종·오퍼링·ISV 로 고른다.
   *
   * ⚠ **is_named 가 false 면 실명(customer_name)을 아예 안 내려보낸다.** 화면에서
   *   숨기는 방식이면 언젠가 어느 화면이 실수한다 — 이 응답은 고객용 키트로 흘러간다.
   *
   * ⚠ **매칭이 0건이면 빈 배열을 준다.** 억지로 붙인 사례가 안 붙인 것보다 나쁘다.
   *   고객이 "이게 우리랑 무슨 상관이죠" 라고 물으면 그 뒤 문서 전체를 안 믿는다.
   */
  /**
   * 딜에 붙일 레퍼런스. 규칙은 lib/case-match.js 에 있다 — 서버와 목업이 같은 것을
   * 쓰고, DB 없이도 검사할 수 있어야 해서 순수 함수로 뺐다.
   *
   * 여기서는 읽어 오기만 한다. **실명을 자르는 것도 그쪽 pickCaseStudies 가 한다.**
   */
  const matchCaseStudies = async (deal, solutionSlugs) => {
    if (!(hasColumn && await hasColumn('case_studies', 'headline'))) return [];
    const { rows } = await pool.query(
      `select id, headline, industry, package_ids, isv_slugs,
              situation, what_we_did, outcome, is_named, customer_name, customer_label, status
         from case_studies where status = 'published' order by sort_order, id`
    );
    return pickCaseStudies(rows, caseContext(deal, solutionSlugs));
  };

  /**
   * 결과 링크. **인증 없이 열린다.**
   *
   * 저장된 집계를 그대로 주지 않고 **고객 원본 응답으로 다시 채점한다.** 032 가
   * readiness_customer_scores 를 따로 만든 이유가 여기서 산다 — 영업이 허브에서
   * 점수를 고쳐도 고객이 받은 링크의 숫자는 안 바뀐다. 처방문(043)이 바뀌면
   * 그건 반영된다. 숫자는 고정, 조언은 최신이다.
   *
   * ⚠ 담당자 이름·전화·이메일을 싣지 않는다. 회사명과 진단 결과까지다.
   */
  router.get('/public/result/:token', async (req, res) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(String(req.params.token || ''))) {
        return res.status(404).json({ error: '결과를 찾을 수 없습니다.' });
      }
      if (!(hasColumn && await hasColumn('leads', 'result_token'))) {
        return sendPublicUnavailable(res, '결과 링크가 아직 준비되지 않았습니다.');
      }
      const { rows } = await pool.query(
        `select l.customer, l.created_at,
                l.created_at > now() - interval '1 year' as fresh,
                d.readiness_customer_scores as scores
           from leads l left join deals d on d.id = l.promoted_deal
          where l.result_token = $1`,
        [req.params.token]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: '결과를 찾을 수 없습니다.' });
      if (!row.fresh) {
        return res.status(410).json({
          error: '이 링크는 유효기간(1년)이 지났습니다. 담당자에게 문의해주세요.'
        });
      }
      const scores = row.scores && typeof row.scores === 'object' ? row.scores : {};
      if (!Object.keys(scores).length) {
        return res.status(404).json({ error: '이 링크에 연결된 진단 응답이 없습니다.' });
      }
      const data = await loadReadinessItems();
      if (!data) return sendPublicUnavailable(res, '진단 문항을 불러올 수 없습니다.');

      const result = scoreReadiness(data.items, data.areas, scores, { partial: true });
      const covering = await coveringPackages(asArray(result.priorities).map((p) => p.area));
      result.priorities = asArray(result.priorities)
        .map((p) => ({ ...p, offerings: covering.get(p.area) || [] }));
      res.json({ customer: row.customer, created_at: row.created_at, result });
    } catch (error) {
      console.error('Result link failed:', error.message);
      sendPublicUnavailable(res, '결과를 불러오지 못했습니다.');
    }
  });

  router.post('/public/leads', checkPublicRateLimit, async (req, res) => {
    let lead;
    try {
      lead = validateLead(req.body);
    } catch (error) {
      return sendError(res, error);
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('begin');
      // 42문항으로 들어왔으면 채점하고 bridge 로 21문항을 채운다.
      let readiness = null;
      if (Object.keys(lead.readiness_scores || {}).length) {
        readiness = await applyReadiness(lead.readiness_scores);
      }
      // 42문항 응답으로 10평가영역을 채운다(037 bridge). 8개가 차고 나머지는
      // 영업이 STEP03 에서 후보별로 확인한다.
      const assessment = await applyAssessment(lead.readiness_scores, null);

      // 031·036 미적용 구간에도 코드가 먼저 배포될 수 있다. 컬럼이 없으면 빼고 넣는다 —
      // 리드 접수 자체가 실패하는 것보다 낫다.
      const hasReadinessCols = hasColumn
        ? await hasColumn('deals', 'readiness_scores') : false;
      const hasAssessmentCols = hasColumn
        ? await hasColumn('deals', 'assessment_scores') : false;
      const dealColumns = ['customer', 'customer_meta', 'track'];
      const dealValues = [lead.customer, lead.customer_meta, lead.track];
      if (hasReadinessCols && readiness) {
        dealColumns.push('readiness_scores', 'readiness_totals');
        dealValues.push(lead.readiness_scores, readiness);
        // 032: 영업이 STEP02 에서 고쳐도 고객이 뭐라고 답했는지는 남는다.
        if (await hasColumn('deals', 'readiness_customer_scores')) {
          dealColumns.push('readiness_customer_scores');
          dealValues.push(lead.readiness_scores);
        }
      }
      if (hasAssessmentCols && assessment) {
        // bridge 로 채운 영역을 기록해 둔다. 영업이 확인해 넣은 값과 갈라야 한다.
        dealColumns.push('assessment_scores', 'assessment_totals');
        dealValues.push(assessment.scores, { ...assessment.totals, bridged: assessment.bridged });
      }
      const dealResult = await client.query(
        `insert into deals (${dealColumns.join(', ')}, stage, source)
         values (${dealValues.map((_, i) => `$${i + 1}`).join(', ')}, 0, 'portal')
         returning id`,
        dealValues
      );
      // 027 미적용 구간에도 코드가 먼저 배포될 수 있다. 컬럼이 없으면 두 항목을 빼고
      // 넣는다 — 리드 접수 자체가 실패하는 것보다 낫다. 담당자 정보는 상담 내용에
      // 남지 않지만 리드는 살아서 영업에게 간다.
      const hasContactCols = hasColumn
        ? await hasColumn('leads', 'contact_name') : false;
      const hasTitleCol = hasColumn ? await hasColumn('leads', 'contact_title') : false;
      const leadColumns = ['customer', 'contact', 'fqa_scores', 'message', 'promoted_deal',
        'consent_version', 'consent_purpose', 'consent_retention'];
      const leadValues = [lead.customer, lead.contact, lead.fqa_scores, lead.message,
        dealResult.rows[0].id, PRIVACY_NOTICE.version, PRIVACY_NOTICE.purpose,
        PRIVACY_NOTICE.retention];
      if (hasContactCols) {
        leadColumns.push('contact_name', 'contact_phone');
        leadValues.push(lead.contact_name, lead.contact_phone);
      }
      if (hasTitleCol) {
        leadColumns.push('contact_title');
        leadValues.push(lead.contact_title || null);
      }
      // 신호만 남긴다. 접수를 막지 않는다 — 자동으로 버리면 진짜 고객을 잃는다.
      if (hasColumn && await hasColumn('leads', 'spam_signals')) {
        leadColumns.push('spam_signals');
        leadValues.push(JSON.stringify(lead.spam_signals || []));
      }
      // 044 미적용 구간에는 토큰 컬럼이 없다. 그때는 결과 링크 없이 접수만 된다.
      const hasResultToken = hasColumn ? await hasColumn('leads', 'result_token') : false;
      const leadResult = await client.query(
        `insert into leads (${leadColumns.join(', ')}, consent_at)
         values (${leadValues.map((_, i) => `$${i + 1}`).join(', ')}, now())
         returning id, created_at${hasResultToken ? ', result_token' : ''}`,
        leadValues
      );
      await client.query('commit');
      // 영업이 가장 먼저 보는 곳이라 연락에 필요한 것만 담는다. 전화번호는 넣지 않는다 —
      // Slack 채널은 보존기간 관리 밖이고 개인정보를 흘릴 자리가 아니다.
      const meta = lead.customer_meta || {};
      const badge = [meta.industry, meta.companySize].filter(Boolean).join(' · ');
      void slackNotify(`🔵 신규 딜: ${lead.customer}`
        + (badge ? ` (${badge})` : '')
        + ` · 담당 ${lead.contact_name} · 포탈 유입 · 담당 미배정`);
      // 결과 링크. 방금 폼을 낸 본인에게만 돌려준다 — 화면이 바로 보여 주고,
      // 메일 발송이 붙으면 같은 값을 본문에 넣는다.
      const resultPath = leadResult.rows[0].result_token
        ? `/r/${leadResult.rows[0].result_token}` : null;
      void sendLeadReceipt({ lead, readiness, resultPath });
      res.status(201).json({
        message: '상담 요청이 접수되었습니다.',
        reference: leadResult.rows[0].id,
        created_at: leadResult.rows[0].created_at,
        result_path: resultPath
      });
    } catch (error) {
      if (client) await client.query('rollback').catch(() => {});
      console.error(error);
      sendError(res, new Error('상담 요청을 저장하지 못했습니다.'), 500);
    } finally {
      if (client) client.release();
    }
  });

  router.use(authenticateToken);

  router.get('/deals', async (req, res) => {
    try {
      const { q = '', stage = '', track = '', mine = '' } = req.query;
      const params = [];
      const conditions = [];
      if (q.trim()) {
        params.push(`%${q.trim()}%`);
        conditions.push(`d.customer ilike $${params.length}`);
      }
      if (stage !== '' && Number.isInteger(Number(stage))) {
        params.push(Number(stage));
        conditions.push(`d.stage = $${params.length}`);
      }
      if (track) {
        params.push(track);
        conditions.push(`d.track = $${params.length}`);
      }
      if (mine === 'true') {
        params.push(req.user.id);
        conditions.push(`d.owner_id = $${params.length}`);
      }
      // 이 목록에는 소유자 게이트가 없다 — 승인된 전 직원이 본다. 아래 컬럼 열거와
      // customer_meta 3키 화이트리스트가 그래서 있다.
      const has041 = hasColumn ? await hasColumn('deals', 'deleted_at') : false;
      if (has041) conditions.push('d.deleted_at is null');
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
      // 카드가 쓰는 것만 싣는다. 041 이전에는 null 로 내려보내 배지·필터가 조용히 꺼진다.
      // ⚠ customer_contact_* 는 **절대 여기 넣지 않는다.** 목록은 전 직원이 본다.
      const pipelineCols = has041
        ? 'd.msp_status, d.inquiry_date, d.stage_changed_at'
        : `null::text as msp_status, null::date as inquiry_date, null::timestamptz as stage_changed_at`;
      // 스팸 신호는 leads 에 있다(접수 시점의 판정이라 딜이 아니라 접수 기록의 것).
      // 개수만 싣는다 — 목록은 전 직원이 보므로 어떤 값이 걸렸는지까지 보낼 이유가 없다.
      const hasSpam = hasColumn ? await hasColumn('leads', 'spam_signals') : false;
      const spamJoin = hasSpam
        ? `left join lateral (select jsonb_array_length(l.spam_signals) as n from leads l
              where l.promoted_deal = d.id order by l.created_at desc limit 1) spam on true`
        : '';
      const spamCol = hasSpam ? 'coalesce(spam.n, 0) as spam_count' : '0 as spam_count';
      // 사이드바 카드는 업종·규모·대상만 쓴다. customer_meta 를 통째로 내보내면
      // 연락처·상담 메모 같은 고객 PII 가 목록 응답에 실린다.
      const result = await pool.query(
        `select d.id, d.customer, d.track, d.stage, d.source,
                d.owner_id, d.updated_at, d.created_at,
                ${pipelineCols},
                ${spamCol},
                jsonb_build_object(
                  'industry',    d.customer_meta -> 'industry',
                  'companySize', d.customer_meta -> 'companySize',
                  'targetUsers', d.customer_meta -> 'targetUsers'
                ) as customer_meta,
                p.full_name as owner_name, t.name as track_name
         from deals d
         left join profiles p on p.id = d.owner_id
         left join tracks t on t.id = d.track
         ${spamJoin}
         ${where}
         order by (d.source = 'portal' and d.owner_id is null) desc, d.updated_at desc`,
        params
      );
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  router.post('/deals', async (req, res) => {
    let deal;
    try {
      deal = validateDealCreate(req.body);
    } catch (error) {
      return sendError(res, error);
    }
    try {
      const result = await pool.query(
        `insert into deals (customer, customer_meta, source, owner_id)
         values ($1, $2, $3, $4) returning *`,
        [deal.customer, deal.customer_meta, deal.source, req.user.id]
      );
      auditLog(req.user.id, 'create', `deal:${result.rows[0].id}`, deal.customer);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  router.get('/deals/:id', async (req, res) => {
    try {
      // 상세 응답에는 고객 실명·연락처·리드 원문이 들어간다. 담당자(owner)와 admin,
      // 그리고 아직 주인이 없어 claim 대상인 딜에만 연다. 남의 딜은 존재 여부까지
      // 숨기려고 403 이 아니라 404 로 답한다.
      // 027 미적용 구간을 대비해 컬럼 존재를 확인하고 고른다. 없으면 null 로 내려
      // 화면이 "포탈 정보 없음" 으로 그려진다 — 상세 조회 자체가 깨지는 것보다 낫다.
      const hasContactCols = hasColumn ? await hasColumn('leads', 'contact_name') : false;
      const hasTitle = hasColumn ? await hasColumn('leads', 'contact_title') : false;
      const leadContactCols = (hasContactCols
        ? 'l.contact, l.message, l.contact_name, l.contact_phone'
        : 'l.contact, l.message, null::text as contact_name, null::text as contact_phone')
        + (hasTitle ? ', l.contact_title' : ', null::text as contact_title')
        + ((hasColumn && await hasColumn('leads', 'spam_signals'))
          ? ', l.spam_signals' : `, '[]'::jsonb as spam_signals`);
      const result = await pool.query(
        `select d.*, p.full_name as owner_name, t.name as track_name,
                lead.contact as lead_contact, lead.message as lead_message,
                lead.contact_name as lead_contact_name,
                lead.contact_phone as lead_contact_phone,
                lead.contact_title as lead_contact_title,
                lead.spam_signals as lead_spam_signals
         from deals d
         left join profiles p on p.id = d.owner_id
         left join tracks t on t.id = d.track
         left join lateral (
           select ${leadContactCols} from leads l
           where l.promoted_deal = d.id order by l.created_at desc limit 1
         ) lead on true
         where d.id = $1
           and ($2 = 'admin' or d.owner_id is null or d.owner_id = $3)${await liveDeal()}`,
        [req.params.id, req.user.role, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });
      auditLog(req.user.id, 'view', `deal:${req.params.id}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });


  /**
   * STEP 03 추천. deals/:id 와 같은 owner 게이트를 건다 — 딜 데이터(FQA·업종·예산)를
   * 입력으로 쓰므로 상세와 같은 수준의 보호가 필요하다.
   *
   * 판정 데이터가 없는 후보는 조용히 빠지지 않고 "판정 데이터 미입력" 사유로 제외
   * 목록에 남는다. 영업에게는 "안 맞아서 제외"와 구분돼야 하고, ISSU 에게는 어떤
   * 솔루션을 먼저 채워야 하는지 신호가 된다.
   */
  router.get('/deals/:id/recommendations', async (req, res) => {
    try {
      const dealResult = await pool.query(
        `select d.* from deals d
          where d.id = $1 and ($2 = 'admin' or d.owner_id is null or d.owner_id = $3)${await liveDeal()}`,
        [req.params.id, req.user.role, req.user.id]
      );
      const deal = dealResult.rows[0];
      if (!deal) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });

      const hasSlot = hasColumn ? await hasColumn('solutions', 'slot') : false;
      if (!hasSlot) {
        return res.status(503).json({
          error: '추천 엔진 스키마가 아직 적용되지 않았습니다. 010~011 마이그레이션을 확인하세요.'
        });
      }

      // 020 미적용 구간에도 코드가 먼저 배포될 수 있다. 컬럼이 없으면 조건을 빼서
      // "숨김 없음"으로 동작한다 — 쿼리가 깨지는 것보다 낫다.
      const hiddenFilter = (hasColumn && await hasColumn('solutions', 'is_hidden'))
        ? 'and s.is_hidden = false' : '';

      // 038 미적용 구간에는 컬럼이 없다. 없으면 빈 값으로 내려 후보가 안 잡히게 둔다 —
      // 옛 어휘로 판정하면 화면과 근거가 어긋난다.
      const hasAssessment = hasColumn ? await hasColumn('solutions', 'assessment_coverage') : false;
      const solutionJudgement = hasAssessment
        ? 's.assessment_coverage, s.assessment_prerequisites'
        : `'[]'::jsonb as assessment_coverage, '[]'::jsonb as assessment_prerequisites`;
      const packageJudgement = hasAssessment
        ? 'p.readiness_coverage, p.assessment_coverage, p.assessment_lift'
        : `'[]'::jsonb as readiness_coverage, '[]'::jsonb as assessment_coverage, '{}'::jsonb as assessment_lift`;

      const [solutions, packages, slotRows, config] = await Promise.all([
        pool.query(
          `select s.id, s.slug, s.name, s.slot, s.layer, s.synergy, s.grade, s.scale,
                  s.status, s.status_op, s.industries,
                  ${solutionJudgement}, s.red_flags, s.bundle_potential
             from solutions s
            where s.is_archived = false and s.status = 'published'
              ${hiddenFilter}
            order by s.slug`
        ).then((r) => r.rows),
        pool.query(
          `select p.id, p.id as slug, p.name, p.scale, p.period, p.target,
                  ${packageJudgement}, p.role, p.depends_on
             from packages p where p.status = 'active'
             order by p.sort_order, p.id`
        ).then((r) => r.rows),
        pool.query(
          `select s.id, s.name, s.layer, s.is_competitive, s.domain, d.name as domain_name
             from solution_slots s left join solution_domains d on d.id = s.domain`
        ).then((r) => r.rows).catch(() => []),
        pool.query('select key, kind, weight, enabled from recommendation_config')
          .then((r) => r.rows).catch(() => [])
      ]);

      // 갭은 두 어휘가 한 맵에 들어온다 — 평가영역(ISV 게이트)과 42문항 축(고객 준비도).
      // 키가 겹치지 않아 솔루션과 패키지가 각자 맞물린다.
      const { totals, labels, itemCount } = buildGapTotals(deal.assessment_totals, deal.readiness_totals);

      // 후보의 커버리지 어휘를 맞춰 넘긴다. 엔진은 어휘를 모른다.
      const asCoverage = (list, key) => asArray(list)
        .map((e) => ({ category: e?.[key], strength: Number(e?.strength) || 0 }))
        .filter((e) => e.category);
      const scoredSolutions = solutions.map((row) => ({
        ...row,
        coverage: asCoverage(row.assessment_coverage, 'area'),
        prerequisites: asArray(row.assessment_prerequisites)
      }));
      const scoredPackages = packages.map((row) => ({
        ...row,
        // 후보 선정은 42문항 축으로, 번들 선행은 평가영역으로. 다른 질문이다.
        coverage: asCoverage(row.readiness_coverage, 'axis'),
        enablerCoverage: asCoverage(row.assessment_coverage, 'area'),
        lift: row.assessment_lift
      }));

      const weights = {};
      const filters = {};
      for (const row of config) {
        if (row.kind === 'rank') weights[row.key] = Number(row.weight);
        if (row.kind === 'filter') filters[row.key] = row.enabled;
      }

      const result = recommend({
        deal,
        solutions: scoredSolutions,
        packages: scoredPackages,
        slots: new Map(slotRows.map((row) => [row.id, row])),
        totals,
        categoryLabels: labels,
        itemCountByCategory: itemCount,
        config: { weights, filters }
      });

      // 레퍼런스는 추천과 같은 재료(업종·조합·패키지)로 고른다. 여기 실어 보내면
      // 화면이 따로 부를 필요가 없다 — 피치와 고객용 키트가 같이 쓴다.
      const comboSlugs = solutions
        .filter((row) => asArray(deal.isv_combo).includes(row.id))
        .map((row) => row.slug).filter(Boolean);
      result.caseStudies = await matchCaseStudies(deal, comboSlugs);

      auditLog(req.user.id, 'view', `deal:${req.params.id}`, 'recommendations');
      res.json(result);
    } catch (error) {
      console.error('Recommendation failed:', error.message);
      sendError(res, error, 500);
    }
  });

  /**
   * 추천·채택 기록. 나중에 실제 채택과 대조해 기준을 튜닝하는 근거가 된다.
   *
   * 병합으로 저장한다. 추천 기록(recommended)과 채택 기록(adopted)이 다른 시점에
   * 들어오는데 덮어쓰면 한쪽이 사라진다.
   *
   * 가장 값진 신호는 manual — 영업이 자기 판단으로 골랐는데 추천 목록에 없던 것이다.
   * 엔진이 놓친 것이고, 그대로 판정 데이터 보강 목록이 된다.
   *
   * 읽기(추천 조회)와 달리 쓰기는 담당자·admin 으로 제한한다. 미배정 딜을 훑어보는
   * 것까지 기록하면 "딜 쓰기는 담당자만" 원칙이 흐려진다. claim 후 STEP 03 에 다시
   * 들어오면 그때 기록되므로 실질적인 데이터 손실은 없다.
   */
  router.post('/deals/:id/recommendations/snapshot', async (req, res) => {
    try {
      if (!(hasColumn && await hasColumn('deals', 'recommendation_snapshot'))) {
        return res.status(503).json({ error: '스냅샷 컬럼이 없습니다. 010 마이그레이션을 확인하세요.' });
      }
      const patch = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await pool.query(
        `update deals
            set recommendation_snapshot = coalesce(recommendation_snapshot, '{}'::jsonb) || $1::jsonb
          where id = $2 and ($3 = 'admin' or owner_id = $4)${await liveDeal('deals')}
          returning id`,
        [JSON.stringify(patch), req.params.id, req.user.role, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });
      res.status(204).end();
    } catch (error) {
      console.error('Snapshot save failed:', error.message);
      sendError(res, error, 500);
    }
  });

  router.patch('/deals/:id', async (req, res) => {
    let patch;
    try {
      patch = normaliseDealPatch(req.body);
    } catch (error) {
      return sendError(res, error);
    }

    try {
      const currentResult = await pool.query('select * from deals where id = $1', [req.params.id]);
      const current = currentResult.rows[0];
      if (!current) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });
      // 지운 딜에 잔여 PATCH 가 들어오면 updated_at 이 갱신되고 SSE 가 다른 브라우저를
      // 깨워 「삭제됨」 상태가 흔들린다. 화면이 타이머를 못 비웠을 때 실제로 온다.
      if (current.deleted_at) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });
      if (req.user.role !== 'admin' && current.owner_id !== req.user.id) {
        return res.status(403).json({ error: '담당자만 이 딜을 수정할 수 있습니다.' });
      }

      // 041 이 아직 안 돌았는데 새 컬럼을 UPDATE 하면 42703 으로 **저장 전체가**
      // 실패한다 — 같은 patch 에 실린 메모·단계까지 같이 날아간다. 조용히 버리지도
      // 않는다. 값이 안 들어갔는데 「자동 저장됨」이 뜨는 쪽이 더 나쁘다.
      const has041 = hasColumn ? await hasColumn('deals', 'stage_changed_at') : false;
      const pending041 = Object.keys(patch).filter((field) => PIPELINE_FIELDS_041.has(field));
      if (!has041 && pending041.length) {
        return res.status(503).json({ error: '딜 확장 컬럼이 없습니다. 041 마이그레이션을 확인하세요.' });
      }

      // 단계가 **실제로 바뀔 때만** 정체 시계를 리셋한다. updated_at 은 메모 한 글자에도
      // 갱신되므로 정체를 못 잰다 — 그래서 이 컬럼이 따로 있다.
      if (has041 && Object.prototype.hasOwnProperty.call(patch, 'stage') && patch.stage !== current.stage) {
        patch.stage_changed_at = new Date().toISOString();
      }

      // 영업이 STEP02 에서 42문항을 고쳤다. 다시 채점하고 평가영역을 다시 채운다.
      // 화면이 계산해 보내게 하면 고객 리포트의 숫자와 갈라진다.
      if (patch.readiness_scores) {
        if (!(hasColumn && await hasColumn('deals', 'readiness_scores'))) {
          return res.status(503).json({ error: '준비도 컬럼이 없습니다. 031 마이그레이션을 확인하세요.' });
        }
        const data = await loadReadinessItems();
        if (!data) return res.status(503).json({ error: '진단 문항을 불러올 수 없습니다.' });

        try {
          // 영업은 채워 넣는 중이라 부분 응답이 정상이다. 고객 진단과 다른 점이다.
          patch.readiness_totals = scoreReadiness(data.items, data.areas, patch.readiness_scores, { partial: true });
        } catch (error) {
          return sendError(res, error);
        }

        // bridge 가 채우는 영역과 영업이 직접 확인한 영역을 가른다. 안 가르면
        // 42문항을 한 번 고칠 때마다 영업이 확인해 넣은 값이 지워진다.
        const assessment = await applyAssessment(patch.readiness_scores, null);
        if (assessment) {
          const previouslyBridged = new Set(asArray(current.assessment_totals?.bridged));
          const manual = {};
          for (const [area, value] of Object.entries(current.assessment_scores || {})) {
            if (!previouslyBridged.has(area)) manual[area] = value;
          }
          const merged = await applyAssessment(patch.readiness_scores, manual);
          patch.assessment_scores = merged.scores;
          patch.assessment_totals = { ...merged.totals, bridged: merged.bridged };
        }
      }

      // 영업이 평가영역을 직접 확인했다. 다시 집계한다.
      if (patch.assessment_scores && !patch.readiness_scores) {
        const data = await loadAssessment();
        if (data) {
          patch.assessment_totals = {
            ...scoreAssessment(data.areas, data.domains, patch.assessment_scores),
            bridged: asArray(current.assessment_totals?.bridged)
          };
        }
      }

      // jsonb columns must receive a JSON string. node-postgres serialises a JS
      // array as a Postgres array literal ({...}), which jsonb rejects with
      // "invalid input syntax for type json" — so stringify these explicitly.
      const JSONB_DEAL_FIELDS = new Set(['isv_combo', 'packages', 'customer_meta',
        'assessment_scores', 'assessment_totals',
        'readiness_scores', 'readiness_totals', 'prereq_confirmations',
        'inquiry_products']);
      const fields = Object.keys(patch);
      const values = fields.map((field) => (JSONB_DEAL_FIELDS.has(field) ? JSON.stringify(patch[field]) : patch[field]));
      values.push(req.params.id);
      const assignments = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
      const result = await pool.query(
        `update deals set ${assignments} where id = $${values.length} returning *`,
        values
      );

      if (Object.prototype.hasOwnProperty.call(patch, 'stage') && patch.stage !== current.stage) {
        void slackNotify(`🟡 단계 이동: ${current.customer} → ${PIPELINE_STAGES[patch.stage]} · ${req.user.name}`);
      }
      auditLog(req.user.id, 'edit', `deal:${req.params.id}`, fields.join(','));
      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  /**
   * 딜 삭제.
   *
   * **soft delete 다.** leads.promoted_deal 이 on delete 절 없이 NO ACTION 이라 포탈
   * 딜을 실제로 지우면 23503 으로 실패한다. 리드를 고아로 만들거나 같이 지우면 동의
   * 이력이 깨진다 — 둘 다 더 나쁘다.
   *
   * **다만 고객 담당자 4종은 함께 지운다.** soft delete 만 하면 「지웠다」고 했는데
   * 이름·이메일이 아무 화면에도 안 보이는 행에 영구히 남는다. 보유기간 파기 절차가
   * 없는 이 시스템에서는 그게 가장 나쁜 형태다.
   *
   * 권한은 쓰기 게이트(담당자·admin)와 같지만 **선조회 + JS 검사**를 쓴다. 한 방
   * 쿼리는 「남의 딜」과 「미배정 딜」을 똑같이 404 로 만드는데, 미배정 딜은 「담당하기
   * 후 삭제」라고 읽을 수 있게 답해야 한다.
   *
   * SSE 는 따로 쏘지 않는다 — trg_deals_notify 가 UPDATE 에 붙어 있어 자동으로 나간다.
   */
  router.delete('/deals/:id', async (req, res) => {
    try {
      if (!(hasColumn && await hasColumn('deals', 'deleted_at'))) {
        return res.status(503).json({ error: '삭제 컬럼이 없습니다. 041 마이그레이션을 확인하세요.' });
      }
      const currentResult = await pool.query(
        'select * from deals where id = $1 and deleted_at is null', [req.params.id]
      );
      const current = currentResult.rows[0];
      if (!current) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });

      if (req.user.role !== 'admin') {
        if (!current.owner_id) {
          return res.status(403).json({ error: '미배정 딜입니다. 「담당하기」 후 삭제할 수 있습니다.' });
        }
        if (current.owner_id !== req.user.id) {
          return res.status(403).json({ error: '담당자만 이 딜을 삭제할 수 있습니다.' });
        }
      }

      await pool.query(
        `update deals
            set deleted_at = now(), deleted_by = $1,
                customer_contact_name = null, customer_contact_dept = null,
                customer_contact_title = null, customer_contact_email = null
          where id = $2`,
        [req.user.id, req.params.id]
      );

      // 고객 담당자 정보는 넣지 않는다. Slack 채널은 보존기간 관리 밖이다.
      void slackNotify(`🗑 딜 삭제: ${current.customer} · ${req.user.name}`);
      auditLog(req.user.id, 'delete', `deal:${req.params.id}`, current.customer);
      res.json({ message: '딜을 삭제했습니다.' });
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  router.post('/deals/:id/claim', async (req, res) => {
    try {
      const result = await pool.query(
        `update deals set owner_id = $1
         where id = $2 and (owner_id is null or $3 = true)${await liveDeal('deals')}
         returning *`,
        [req.user.id, req.params.id, req.user.role === 'admin']
      );
      if (!result.rows[0]) {
        return res.status(409).json({ error: '이미 다른 담당자에게 배정된 딜입니다.' });
      }
      void slackNotify(`👤 담당 배정: ${result.rows[0].customer} · ${req.user.name}`);
      auditLog(req.user.id, 'assign', `deal:${req.params.id}`, req.user.name);
      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  router.put('/deals/:id/owner', adminOnly, async (req, res) => {
    const ownerId = req.body?.owner_id || null;
    try {
      const result = await pool.query(
        `update deals set owner_id = $1 where id = $2${await liveDeal('deals')} returning *`,
        [ownerId, req.params.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });
      auditLog(req.user.id, 'assign', `deal:${req.params.id}`, ownerId || 'unassigned');
      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  /**
   * 기획안 §6 ISV 확장 패키지.
   *
   * 멤버 이름을 여기서 붙여 내려보낸다. 화면이 slug 로 다시 조회하면 숨김 솔루션
   * (palo-alto 등)이 안 잡혀 구성이 반쪽으로 보인다.
   *
   * 033 미적용 구간에는 빈 배열로 간다 — 번들이 안 보이는 것이 STEP03 이 통째로
   * 깨지는 것보다 낫다.
   */
  const loadIsvBundles = async () => {
    if (!(hasColumn && await hasColumn('isv_bundles', 'readiness_signal'))) return [];
    const result = await pool.query(
      `select b.id, b.name, b.value_prop, b.entry_combo, b.applies_when,
              b.is_priority, b.readiness_signal, b.sort_order,
              coalesce(json_agg(json_build_object(
                'slug', m.solution_slug,
                'name', coalesce(s.name, m.solution_slug),
                'is_option', m.is_option,
                'is_hidden', coalesce(s.is_hidden, false)
              ) order by m.is_option, m.sort_order)
                filter (where m.solution_slug is not null), '[]') as members
         from isv_bundles b
         left join isv_bundle_members m on m.bundle_id = b.id
         left join solutions s on s.slug = m.solution_slug
        group by b.id order by b.sort_order`
    );
    return result.rows;
  };

  router.get('/reference-data', async (_req, res) => {
    try {
      // `p.*` 를 쓰면 packages 에 나중에 추가되는 컬럼(원가성 필드 등)이 자동으로
      // 전 직원에게 흘러간다. 화면이 실제로 쓰는 컬럼만 명시한다.
      const [packageFlag, solutionFlag] = await Promise.all([
        hasPriceFlag('packages'),
        hasPriceFlag('solutions')
      ]);
      const packagePlaceholder = packageFlag ? 'p.price_is_placeholder' : 'true';
      const solutionPlaceholder = solutionFlag ? 's.price_is_placeholder' : 'true';
      // 판정 데이터 보유 여부로 카탈로그 노출을 가른다. 010 미적용 환경에서는
      // 전부 보이게 둔다(빈 배열이면 감춰져 카탈로그가 통째로 사라진다).
      const hasCoverage = hasColumn ? await hasColumn('solutions', 'assessment_coverage') : false;
      const coverageColumn = hasCoverage ? 's.assessment_coverage' : `'[{"legacy":true}]'::jsonb`;
      // 020 미적용이면 조건을 빼서 "숨김 없음"으로 동작한다.
      const refHiddenFilter = (hasColumn && await hasColumn('solutions', 'is_hidden'))
        ? 'and s.is_hidden = false' : '';
      // 세일즈 피치가 "이 평가영역을 어느 패키지가 덮는가" 를 대조한다.
      const hasPackageCoverage = hasColumn
        ? await hasColumn('packages', 'assessment_coverage') : false;

      const [assessment, readiness, isvBundles, tracks, packages, solutions, settings] = await Promise.all([
        loadAssessment(),
        loadReadinessItems(),
        loadIsvBundles(),
        pool.query('select id, name, why, warn, ask from tracks order by id').then((r) => r.rows),
        pool.query(
          // assessment_coverage 는 세일즈 피치가 쓴다 — 고객이 물을 만한 평가영역을
          // 어느 패키지가 실제로 다루는지 대조해야 "그건 안 덮습니다" 를 말할 수 있다.
          `select p.id, p.name, p.scale, p.period, p.target, p.sort_order,
                  p.base_md, p.unit_price, ${packagePlaceholder} as price_is_placeholder,
                  ${hasPackageCoverage ? 'p.assessment_coverage' : `'[]'::jsonb as assessment_coverage`},
                  coalesce(json_agg(json_build_object('type', pi.type, 'label', pi.label)
                    order by pi.sort_order) filter (where pi.id is not null), '[]') as items
           from packages p left join package_items pi on pi.package_id = p.id
           where p.status = 'active' group by p.id order by p.sort_order`
        ).then((r) => r.rows),
        pool.query(
          `select s.id, s.slug, s.name, s.category, s.jtbd, s.grade, s.scale,
                  s.tech_note, s.status_op, s.price_type, s.unit_price, s.currency, s.price_tiers,
                  ${solutionPlaceholder} as price_is_placeholder,
                  ${coverageColumn} as assessment_coverage,
                  f.name as focal_name, f.org as focal_org
           from solutions s left join focal_contacts f on f.id = s.focal_id
           where s.is_archived = false and s.status = 'published'
             ${refHiddenFilter}
             and coalesce(s.status_op, 'active') <> 'draft'
           order by coalesce(s.grade, 0) desc, s.name`
        ).then((r) => r.rows),
        pool.query('select usd_krw from hub_settings where id = true').then((r) => r.rows[0] || { usd_krw: 1400 })
      ]);
      res.json({
        stages: PIPELINE_STAGES, tracks, packages, solutions, settings,
        // 029 미적용 구간에는 빈 배열로 간다. 허브가 STEP02 를 못 그리는 것보다
        // 문항 없이 뜨는 편이 낫다 — 나머지 단계는 그대로 돌아간다.
        readinessAreas: readiness?.areas || [],
        readinessItems: readiness?.items || [],
        // 036 미적용 구간에는 빈 배열로 간다. STEP03 확인 목록이 안 뜰 뿐이다.
        assessmentDomains: assessment?.domains || [],
        assessmentAreas: assessment?.areas || [],
        // 세일즈 피치 부록이 쓴다. admin 은 카탈로그에서 내부 불릿을 봐야 하지만
        // **피치 문서에는 어느 역할이든 들어가면 안 된다** — 그 PDF 가 고객에게 간다.
        // 목록을 화면에 또 적으면 갈라지므로 단일 출처(section-privacy)에서 내려보낸다.
        internalBulletLabels: INTERNAL_BULLET_LABELS,
        isvBundles
      });
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  router.get('/team', async (_req, res) => {
    try {
      const result = await pool.query(
        `select id, full_name, team, role from profiles where approved = true order by full_name`
      );
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  });

  router.get('/events', async (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.flushHeaders();
    eventStreams.add(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ user: req.user.id })}\n\n`);
    void ensureDealListener();

    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n');
    }, 25000);
    keepAlive.unref?.();

    req.on('close', () => {
      clearInterval(keepAlive);
      eventStreams.delete(res);
      if (!eventStreams.size) void stopDealListener();
    });
  });

  router.dispose = async () => {
    for (const stream of eventStreams) stream.end();
    eventStreams.clear();
    if (dealListenerPromise) await dealListenerPromise.catch(() => {});
    await stopDealListener();
  };

  return router;
}

module.exports = { createHubRouter };
