const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 6
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const usersToCreate = [
  { email: 'admin@mzc.co.kr', password: 'vudckdWlq1!', role: 'admin', approved: true },
  { email: 'viewer@mzc.co.kr', password: 'vudckdWlq1!', role: 'viewer', approved: true },
  { email: 'pending@mzc.co.kr', password: 'vudckdWlq1!', role: 'viewer', approved: false }
];

async function run() {
  for (const u of usersToCreate) {
    console.log(`Creating user: ${u.email}...`);
    try {
      // 1. Supabase Auth 가입 시도
      const { data, error } = await supabase.auth.signUp({
        email: u.email,
        password: u.password
      });

      if (error) {
        if (error.message.includes('already registered')) {
          console.log(`User ${u.email} is already registered in Auth.`);
        } else {
          console.error(`Error signing up ${u.email}:`, error.message);
          continue;
        }
      } else {
        console.log(`User ${u.email} signed up successfully.`);
      }

      // 2. Auth user id 찾기
      const userRes = await pool.query('SELECT id FROM auth.users WHERE email = $1', [u.email]);
      if (userRes.rows.length > 0) {
        const authId = userRes.rows[0].id;
        
        // 이메일 인증 강제 패스 (confirmed_at 설정)
        await pool.query(
          "UPDATE auth.users SET confirmed_at = now(), email_confirmed_at = now(), last_sign_in_at = now() WHERE id = $1",
          [authId]
        );
        console.log(`User ${u.email} auth account marked as confirmed in DB.`);

        // 3. Profiles 테이블 업데이트 (트리거가 이미 생성했을 테지만, 없다면 수동 인서트하고, 있다면 롤 및 승인 여부 강제 갱신)
        const profileRes = await pool.query('SELECT id FROM public.profiles WHERE id = $1', [authId]);
        if (profileRes.rows.length === 0) {
          console.log(`Profile for ${u.email} not found. Inserting manually...`);
          await pool.query(
            "INSERT INTO public.profiles (id, email, full_name, team, role, approved) VALUES ($1, $2, $3, $4, $5::app_role, $6)",
            [authId, u.email, u.email.split('@')[0], 'Sales Team', u.role, u.approved]
          );
        } else {
          console.log(`Profile for ${u.email} exists. Updating role and approved status...`);
          await pool.query(
            "UPDATE public.profiles SET role = $1::app_role, approved = $2 WHERE id = $3",
            [u.role, u.approved, authId]
          );
        }
        console.log(`User ${u.email} profile configured: role=${u.role}, approved=${u.approved}`);
      }
    } catch (e) {
      console.error(`Error processing ${u.email}:`, e);
    }
  }
  await pool.end();
  console.log('All user creation processing completed.');
}

run();
