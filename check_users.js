const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
  // No forced IP family: the Supabase pooler host is IPv4-only. See server.js.
});

async function check() {
  try {
    const authUsers = await pool.query('SELECT id, email, created_at FROM auth.users');
    console.log('--- auth.users ---');
    console.log(authUsers.rows);

    const profiles = await pool.query('SELECT id, email, role, approved FROM public.profiles');
    console.log('--- public.profiles ---');
    console.log(profiles.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
