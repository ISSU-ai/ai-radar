const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

if (!process.env.TEST_USER_PASSWORD) {
  console.error('TEST_USER_PASSWORD is required to create temporary test accounts.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 6
});

const users = [
  { email: 'wonzero@mz.co.kr', password: process.env.TEST_USER_PASSWORD, role: 'admin', approved: true },
  { email: 'admin@mz.co.kr', password: process.env.TEST_USER_PASSWORD, role: 'admin', approved: true },
  { email: 'dataai@mz.co.kr', password: process.env.TEST_USER_PASSWORD, role: 'viewer', approved: true }
];


async function run() {
  try {
    // 0. 기존 유저 및 관련 기록 전체 비우기 (외래키 순서 고려)
    console.log('Cleaning existing user accounts and audit logs...');
    
    // 1) audit_log 삭제
    await pool.query('DELETE FROM public.audit_log');
    console.log('Cleared public.audit_log.');

    // 2) solutions 및 solution_versions 의 유저 FK 임시 해제(null 처리)
    await pool.query('UPDATE public.solutions SET updated_by = null');
    await pool.query('UPDATE public.solution_versions SET editor = null');
    console.log('Unlinked user references in solutions and versions.');

    // 3) profiles 삭제
    await pool.query('DELETE FROM public.profiles');
    console.log('Cleared public.profiles.');

    // 4) auth.users 삭제
    await pool.query('DELETE FROM auth.users');
    console.log('Cleared auth.users.');

    // 1. auth.users 테이블 컬럼 조회 (안정성 체크)
    console.log('Querying auth.users columns...');
    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'auth' AND table_name = 'users'
    `);
    const cols = columnsRes.rows.map(r => r.column_name);
    console.log('Columns in auth.users:', cols.join(', '));

    // 2. 신규 사용자 삽입
    for (const u of users) {
      console.log(`Inserting direct user: ${u.email}...`);
      
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(u.password, salt);

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
      const userId = res.rows[0].id;
      console.log(`Inserted ${u.email} into auth.users with ID ${userId}`);

      // 3. public.profiles 테이블도 직접 동기화 (트리거에 의해 자동 생성된 값을 어드민/승인 상태로 업데이트)
      console.log(`Updating profile for ${u.email}...`);
      await pool.query(`
        UPDATE public.profiles
        SET role = $1::app_role, approved = $2, full_name = $3, team = $4
        WHERE id = $5
      `, [u.role, u.approved, u.email.split('@')[0], 'MZC Team', userId]);
      console.log(`Updated profile for ${u.email}`);
    }
  } catch (err) {
    console.error('Direct User Reinitialization failed:', err);
  } finally {
    await pool.end();
  }
}

run();
