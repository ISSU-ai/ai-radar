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

const STALE_RATE_LIMIT_MS = 15 * 60 * 1000;
const PUBLIC_LEAD_LIMIT = 8;
const PRIVACY_NOTICE = Object.freeze({
  version: '2026-07-22-v1',
  purpose: 'AI 준비도 진단 결과를 바탕으로 한 상담 접수, 담당자 연락 및 제안 준비',
  retention: '상담 요청일로부터 1년'
});

const { recommend } = require('../lib/recommendation-engine');
const { scoreReadiness } = require('../lib/readiness-scoring');
const { scoreAssessment, bridgeAssessmentScores, buildGapTotals } = require('../lib/assessment-scoring');

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
    const [areas, items] = await Promise.all([
      pool.query('select id, name, sort_order from readiness_areas order by sort_order'),
      pool.query(`select code, area, seq, respondent, text, detail, rubric, target
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

  // 점수 계산. 저장하지 않는다 — 상담 요청은 별도 경로다.
  router.post('/public/readiness', async (req, res) => {
    try {
      const data = await loadReadinessItems();
      if (!data) {
        return sendPublicUnavailable(res, '준비도 진단 문항이 아직 준비되지 않았습니다.');
      }
      const result = scoreReadiness(data.items, data.areas, req.body?.scores);
      res.json(result);
    } catch (error) {
      if (error?.expected) return sendError(res, error);
      console.error('Readiness scoring failed:', error.message);
      sendPublicUnavailable(res, '준비도 결과를 계산하지 못했습니다.');
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
      const leadColumns = ['customer', 'contact', 'fqa_scores', 'message', 'promoted_deal',
        'consent_version', 'consent_purpose', 'consent_retention'];
      const leadValues = [lead.customer, lead.contact, lead.fqa_scores, lead.message,
        dealResult.rows[0].id, PRIVACY_NOTICE.version, PRIVACY_NOTICE.purpose,
        PRIVACY_NOTICE.retention];
      if (hasContactCols) {
        leadColumns.push('contact_name', 'contact_phone');
        leadValues.push(lead.contact_name, lead.contact_phone);
      }
      const leadResult = await client.query(
        `insert into leads (${leadColumns.join(', ')}, consent_at)
         values (${leadValues.map((_, i) => `$${i + 1}`).join(', ')}, now())
         returning id, created_at`,
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
      res.status(201).json({
        message: '상담 요청이 접수되었습니다.',
        reference: leadResult.rows[0].id,
        created_at: leadResult.rows[0].created_at
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
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
      // 사이드바 카드는 업종·규모·대상만 쓴다. customer_meta 를 통째로 내보내면
      // 연락처·상담 메모 같은 고객 PII 가 목록 응답에 실린다.
      const result = await pool.query(
        `select d.id, d.customer, d.track, d.stage, d.source,
                d.owner_id, d.updated_at, d.created_at,
                jsonb_build_object(
                  'industry',    d.customer_meta -> 'industry',
                  'companySize', d.customer_meta -> 'companySize',
                  'targetUsers', d.customer_meta -> 'targetUsers'
                ) as customer_meta,
                p.full_name as owner_name, t.name as track_name
         from deals d
         left join profiles p on p.id = d.owner_id
         left join tracks t on t.id = d.track
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
      const leadContactCols = hasContactCols
        ? 'l.contact, l.message, l.contact_name, l.contact_phone'
        : 'l.contact, l.message, null::text as contact_name, null::text as contact_phone';
      const result = await pool.query(
        `select d.*, p.full_name as owner_name, t.name as track_name,
                lead.contact as lead_contact, lead.message as lead_message,
                lead.contact_name as lead_contact_name,
                lead.contact_phone as lead_contact_phone
         from deals d
         left join profiles p on p.id = d.owner_id
         left join tracks t on t.id = d.track
         left join lateral (
           select ${leadContactCols} from leads l
           where l.promoted_deal = d.id order by l.created_at desc limit 1
         ) lead on true
         where d.id = $1
           and ($2 = 'admin' or d.owner_id is null or d.owner_id = $3)`,
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
          where d.id = $1 and ($2 = 'admin' or d.owner_id is null or d.owner_id = $3)`,
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
          where id = $2 and ($3 = 'admin' or owner_id = $4)
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
      if (req.user.role !== 'admin' && current.owner_id !== req.user.id) {
        return res.status(403).json({ error: '담당자만 이 딜을 수정할 수 있습니다.' });
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
        'readiness_scores', 'readiness_totals', 'prereq_confirmations']);
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

  router.post('/deals/:id/claim', async (req, res) => {
    try {
      const result = await pool.query(
        `update deals set owner_id = $1
         where id = $2 and (owner_id is null or $3 = true)
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
        `update deals set owner_id = $1 where id = $2 returning *`,
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
