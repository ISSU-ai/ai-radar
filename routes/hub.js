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

function createHubRouter({ pool, authenticateToken, adminOnly, auditLog }) {
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
      const result = await pool.query(
        `select d.id, d.customer, d.customer_meta, d.track, d.stage, d.source,
                d.owner_id, d.updated_at, d.created_at,
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
         where d.id = $1`,
        [req.params.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: '딜을 찾을 수 없습니다.' });
      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
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
      const [fqaItems, tracks, packages, solutions] = await Promise.all([
        loadFqaItems(),
        pool.query('select id, name, why, warn, ask from tracks order by id').then((r) => r.rows),
        pool.query(
          `select p.*,
                  coalesce(json_agg(json_build_object('type', pi.type, 'label', pi.label)
                    order by pi.sort_order) filter (where pi.id is not null), '[]') as items
           from packages p left join package_items pi on pi.package_id = p.id
           where p.status = 'active' group by p.id order by p.sort_order`
        ).then((r) => r.rows),
        pool.query(
          `select s.id, s.slug, s.name, s.category, s.jtbd, s.grade, s.scale,
                  s.tech_note, s.status_op, s.price_type, s.unit_price,
                  f.name as focal_name, f.org as focal_org
           from solutions s left join focal_contacts f on f.id = s.focal_id
           where s.is_archived = false and s.status = 'published'
             and coalesce(s.status_op, 'active') <> 'draft'
           order by coalesce(s.grade, 0) desc, s.name`
        ).then((r) => r.rows)
      ]);
      res.json({ stages: PIPELINE_STAGES, fqaItems, tracks, packages, solutions });
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
