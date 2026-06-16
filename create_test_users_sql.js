const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 6
});

const users = [
  { email: 'admin@mzc.co.kr', password: 'vudckdWlq1!', role: 'admin', approved: true },
  { email: 'viewer@mzc.co.kr', password: 'vudckdWlq1!', role: 'viewer', approved: true },
  { email: 'pending@mzc.co.kr', password: 'vudckdWlq1!', role: 'viewer', approved: false }
];

async function run() {
  try {
    // 1. auth.users 테이블 컬럼 조회
    console.log('Querying auth.users columns...');
    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'auth' AND table_name = 'users'
    `);
    const cols = columnsRes.rows.map(r => r.column_name);
    console.log('Columns in auth.users:', cols.join(', '));

    // 2. 각 유저에 대해 삽입 시도
    for (const u of users) {
      console.log(`Processing user directly in DB: ${u.email}...`);
      
      // 기존 auth.users에 이미 있는지 체크
      const existRes = await pool.query('SELECT id FROM auth.users WHERE email = $1', [u.email]);
      let userId;
      
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(u.password, salt);

      if (existRes.rows.length === 0) {
        console.log(`Inserting into auth.users...`);
        // Supabase Auth에 이메일 기반 가입자 정보 insert
        const insertAuthQuery = `
          INSERT INTO auth.users (
            id, instance_id, aud, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, is_super_admin, role,
            created_at, updated_at, confirmation_token, recovery_token,
            email_change_token_new, email_change, phone_change, phone_change_token,
            email_change_token_current, reauthentication_token, phone
          )
          VALUES (
            gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', $1, $2, now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, 'authenticated',
            now(), now(), '', '', '', '', '', '', '', '', null
          )
          RETURNING id;
        `;
        const res = await pool.query(insertAuthQuery, [u.email, hash]);
        userId = res.rows[0].id;
        console.log(`Inserted ${u.email} into auth.users with ID ${userId}`);
      } else {
        userId = existRes.rows[0].id;
        console.log(`User ${u.email} already exists in auth.users. Updating password hash and aud...`);
        await pool.query("UPDATE auth.users SET encrypted_password = $1, aud = 'authenticated', email_confirmed_at = now() WHERE id = $2", [hash, userId]);
      }

      // 3. public.profiles 테이블도 직접 동기화/업데이트
      console.log(`Syncing profile for ${u.email}...`);
      const profCheck = await pool.query('SELECT id FROM public.profiles WHERE id = $1', [userId]);
      if (profCheck.rows.length === 0) {
        await pool.query(`
          INSERT INTO public.profiles (id, email, full_name, team, role, approved)
          VALUES ($1, $2, $3, $4, $5::app_role, $6)
        `, [userId, u.email, u.email.split('@')[0], 'Sales Team', u.role, u.approved]);
        console.log(`Created new profile record.`);
      } else {
        await pool.query(`
          UPDATE public.profiles
          SET email = $1, role = $2::app_role, approved = $3
          WHERE id = $4
        `, [u.email, u.role, u.approved, userId]);
        console.log(`Updated existing profile record.`);
      }
    }
  } catch (err) {
    console.error('SQL Direct User Injection failed:', err);
  } finally {
    await pool.end();
  }
}

run();
