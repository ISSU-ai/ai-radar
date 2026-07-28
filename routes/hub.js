'use strict';

const express = require('express');
const {
  PIPELINE_STAGES,
  calculateFqaTotals,
  normaliseDealPatch,
  validateDealCreate,
  validateLead
} = require('../lib/hub-domain');

const STALE_RATE_LIMIT_MS = 15 * 60 * 1000;
const PUBLIC_LEAD_LIMIT = 8;
const PRIVACY_NOTICE = Object.freeze({
  version: '2026-07-22-v1',
  purpose: 'AI 준비도 진단 결과를 바탕으로 한 상담 접수, 담당자 연락 및 제안 준비',
  retention: '상담 요청일로부터 1년'
});

const { recommend } = require('../lib/recommendation-engine');

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

  const sendError = (res, error, status = 400) => {
    const message = error instanceof Error ? error.message : '요청을 처리할 수 없습니다.';
    return res.status(status).json({ error: message });
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

  const loadFqaItems = () => pool.query(
    `select id, category, no, name, weight, detail, fix, threshold
     from fqa_items where status = 'active' order by no`
  ).then((result) => result.rows);

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

  router.get('/public/fqa-items', async (_req, res) => {
    try {
      const result = await pool.query(
        `select id, category, no, name, detail
         from fqa_items where status = 'active' order by no`
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Public FQA items failed:', error.message);
      sendPublicUnavailable(res, '준비도 진단 문항을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  });

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

  router.post('/public/diagnose', async (req, res) => {
    try {
      const items = await loadFqaItems();
      const totals = calculateFqaTotals(items, req.body?.fqa_scores || {});
      const categories = Object.entries(totals).map(([category, value]) => ({
        category,
        score: value.score,
        answered: value.answered,
        status: value.ready ? 'ready' : 'strengthen'
      }));
      const average = categories.length
        ? categories.reduce((sum, item) => sum + item.score, 0) / categories.length
        : 0;
      const summary = average >= 4 ? '확장 준비 단계' : average >= 3 ? '검증 준비 단계' : '기반 정비 단계';
      res.json({ categories, summary });
    } catch (error) {
      console.error('Public diagnosis failed:', error.message);
      sendPublicUnavailable(res, '준비도 진단 결과를 계산하지 못했습니다. 잠시 후 다시 시도해주세요.');
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
      const fqaItems = await client.query(
        `select category, no, weight, threshold from fqa_items where status = 'active' order by no`
      );
      const fqaTotals = calculateFqaTotals(fqaItems.rows, lead.fqa_scores);
      const dealResult = await client.query(
        `insert into deals
          (customer, customer_meta, fqa_scores, fqa_totals, track, stage, source)
         values ($1, $2, $3, $4, $5, 0, 'portal') returning id`,
        [lead.customer, lead.customer_meta, lead.fqa_scores, fqaTotals, lead.track]
      );
      const leadResult = await client.query(
        `insert into leads
          (customer, contact, fqa_scores, message, promoted_deal,
           consent_at, consent_version, consent_purpose, consent_retention)
         values ($1, $2, $3, $4, $5, now(), $6, $7, $8)
         returning id, created_at`,
        [
          lead.customer,
          lead.contact,
          lead.fqa_scores,
          lead.message,
          dealResult.rows[0].id,
          PRIVACY_NOTICE.version,
          PRIVACY_NOTICE.purpose,
          PRIVACY_NOTICE.retention
        ]
      );
      await client.query('commit');
      void slackNotify(`🔵 신규 딜: ${lead.customer} · 포탈 유입 · 담당 미배정`);
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
      const result = await pool.query(
        `select d.*, p.full_name as owner_name, t.name as track_name,
                lead.contact as lead_contact, lead.message as lead_message
         from deals d
         left join profiles p on p.id = d.owner_id
         left join tracks t on t.id = d.track
         left join lateral (
           select l.contact, l.message from leads l
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

      const [solutions, packages, slotRows, fqaItems, config] = await Promise.all([
        pool.query(
          `select s.id, s.slug, s.name, s.slot, s.layer, s.synergy, s.grade, s.scale,
                  s.status, s.status_op, s.industries,
                  s.fqa_coverage, s.prerequisites, s.red_flags, s.bundle_potential
             from solutions s
            where s.is_archived = false and s.status = 'published'`
        ).then((r) => r.rows),
        pool.query(
          `select p.id, p.id as slug, p.name, p.scale, p.period, p.target,
                  p.fqa_coverage, p.prerequisites
             from packages p where p.status = 'active'`
        ).then((r) => r.rows),
        pool.query(
          `select s.id, s.name, s.layer, s.is_competitive, s.domain, d.name as domain_name
             from solution_slots s left join solution_domains d on d.id = s.domain`
        ).then((r) => r.rows).catch(() => []),
        loadFqaItems(),
        pool.query('select key, kind, weight, enabled from recommendation_config')
          .then((r) => r.rows).catch(() => [])
      ]);

      const itemCountByCategory = fqaItems.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1;
        return acc;
      }, {});
      // 문항 단위 전제(예: A[보안 게이트웨이 준비도] ≥ 3)를 카테고리 평균 대신
      // 실제 문항 점수로 판정할 수 있게 이름→점수 맵을 만든다.
      const rawScores = deal.fqa_scores && typeof deal.fqa_scores === 'object' ? deal.fqa_scores : {};
      const itemScores = {};
      for (const item of fqaItems) {
        const score = Number(rawScores[item.no] ?? rawScores[String(item.no)]);
        if (Number.isFinite(score)) itemScores[item.name] = score;
      }

      const weights = {};
      const filters = {};
      for (const row of config) {
        if (row.kind === 'rank') weights[row.key] = Number(row.weight);
        if (row.kind === 'filter') filters[row.key] = row.enabled;
      }

      const result = recommend({
        deal,
        solutions,
        packages,
        slots: new Map(slotRows.map((row) => [row.id, row])),
        itemCountByCategory,
        itemScores,
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

      if (patch.fqa_scores) {
        const items = await loadFqaItems();
        patch.fqa_totals = calculateFqaTotals(items, patch.fqa_scores);
      }

      // jsonb columns must receive a JSON string. node-postgres serialises a JS
      // array as a Postgres array literal ({...}), which jsonb rejects with
      // "invalid input syntax for type json" — so stringify these explicitly.
      const JSONB_DEAL_FIELDS = new Set(['isv_combo', 'packages', 'customer_meta', 'fqa_scores', 'fqa_totals']);
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

      const [fqaItems, tracks, packages, solutions, settings] = await Promise.all([
        loadFqaItems(),
        pool.query('select id, name, why, warn, ask from tracks order by id').then((r) => r.rows),
        pool.query(
          `select p.id, p.name, p.scale, p.period, p.target, p.sort_order,
                  p.base_md, p.unit_price, ${packagePlaceholder} as price_is_placeholder,
                  coalesce(json_agg(json_build_object('type', pi.type, 'label', pi.label)
                    order by pi.sort_order) filter (where pi.id is not null), '[]') as items
           from packages p left join package_items pi on pi.package_id = p.id
           where p.status = 'active' group by p.id order by p.sort_order`
        ).then((r) => r.rows),
        pool.query(
          `select s.id, s.slug, s.name, s.category, s.jtbd, s.grade, s.scale,
                  s.tech_note, s.status_op, s.price_type, s.unit_price, s.currency, s.price_tiers,
                  ${solutionPlaceholder} as price_is_placeholder,
                  f.name as focal_name, f.org as focal_org
           from solutions s left join focal_contacts f on f.id = s.focal_id
           where s.is_archived = false and s.status = 'published'
             and coalesce(s.status_op, 'active') <> 'draft'
           order by coalesce(s.grade, 0) desc, s.name`
        ).then((r) => r.rows),
        pool.query('select usd_krw from hub_settings where id = true').then((r) => r.rows[0] || { usd_krw: 1400 })
      ]);
      res.json({ stages: PIPELINE_STAGES, fqaItems, tracks, packages, solutions, settings });
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
