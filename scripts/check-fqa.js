'use strict';

/**
 * Reproduce exactly what the running app does when it loads the readiness
 * questions: connect via the same pooler DATABASE_URL / role and run the
 * app's UNQUALIFIED query (`from fqa_items`, no schema prefix). Prints the
 * session's role/database/search_path so we can see whether `public` is on
 * the path — an empty/wrong search_path is what makes an existing table look
 * like "relation does not exist" to the app while a schema-qualified query
 * (public.fqa_items) still works.
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
 *     node scripts/check-fqa.js
 */

const { Client } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
  await c.connect();

  const who = (await c.query('select current_user, current_database()')).rows[0];
  const sp = (await c.query('show search_path')).rows[0];
  console.log('connected as :', who.current_user, '/ db:', who.current_database);
  console.log('search_path  :', sp.search_path);

  // Exactly the app's query (unqualified, like routes/hub.js).
  try {
    const r = await c.query(
      "select id, category, no, name, detail from fqa_items where status = 'active' order by no"
    );
    console.log('UNQUALIFIED "from fqa_items" ->', r.rowCount, 'rows  ✅');
  } catch (e) {
    console.error('UNQUALIFIED "from fqa_items" -> FAILED:', e.message, ' ❌');
  }

  // Schema-qualified control (should always work if the table exists).
  try {
    const r = await c.query('select count(*)::int as n from public.fqa_items');
    console.log('QUALIFIED  "public.fqa_items" ->', r.rows[0].n, 'rows');
  } catch (e) {
    console.error('QUALIFIED  "public.fqa_items" -> FAILED:', e.message);
  }

  await c.end();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
