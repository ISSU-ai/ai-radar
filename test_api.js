const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

if (!process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('Missing required Supabase environment variables in .env for running test_api.js');
  process.exit(1);
}

// Clients for test-level direct DB access
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 6
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Helper function to make API requests
function makeRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function getCookieHeader(response) {
  const cookies = response.headers['set-cookie'];
  if (!cookies) return '';
  return cookies.map(c => c.split(';')[0]).join('; ');
}

async function runTests() {
  console.log('==================================================');
  console.log(' Starting ISSU AI Radar Backend API Verification...');
  console.log('==================================================');

  let testCount = 0;
  let successCount = 0;
  let pendingUserId = null;

  function assert(condition, message, extra = null) {
    testCount++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      successCount++;
    } else {
      console.error(`[FAIL] ${message}`);
      if (extra) {
        console.error(`       Response:`, typeof extra === 'object' ? JSON.stringify(extra) : extra);
      }
    }
  }

  const tempPendingEmail = 'pending_test@mz.co.kr';

  try {
    // 0. Setup/Check database test accounts
    console.log('Checking test accounts sync...');
    
    // wonzero@mz.co.kr 및 admin@mz.co.kr 계정 존재 확인
    const adminCheck = await pool.query("SELECT id FROM profiles WHERE email = 'admin@mz.co.kr'");
    const userCheck = await pool.query("SELECT id FROM profiles WHERE email = 'wonzero@mz.co.kr'");
    
    if (adminCheck.rows.length === 0 || userCheck.rows.length === 0) {
      console.log('[WARN] Required test accounts (admin@mz.co.kr, wonzero@mz.co.kr) not found in profiles. Please run seed/setup first.');
    } else {
      // 뷰어 역할 테스트를 위해 임시로 wonzero@mz.co.kr을 viewer로 변경 (원래 admin)
      await pool.query("UPDATE profiles SET role = 'viewer', approved = true WHERE email = 'wonzero@mz.co.kr'");
      // admin@mz.co.kr은 어드민 유지
      await pool.query("UPDATE profiles SET role = 'admin', approved = true WHERE email = 'admin@mz.co.kr'");
      console.log('Test accounts (wonzero as viewer, admin as admin) synced in profiles table.');
    }

    // 0-1. 미승인(pending) 임시 계정 생성
    console.log('Setting up temporary pending account...');
    // 혹시 모를 기존 데이터 정리
    await pool.query("DELETE FROM public.profiles WHERE email = $1", [tempPendingEmail]);
    await pool.query("DELETE FROM auth.users WHERE email = $1", [tempPendingEmail]);

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123!', salt);

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
    const resPending = await pool.query(insertAuthQuery, [tempPendingEmail, hash]);
    pendingUserId = resPending.rows[0].id;

    // 트리거에 의해 profiles 레코드가 자동 생성되었을 것이므로, approved=false, role=viewer로 강제 업데이트
    await pool.query(`
      UPDATE public.profiles
      SET role = 'viewer', approved = false, full_name = '대기사용자', team = 'Test Team'
      WHERE id = $1
    `, [pendingUserId]);
    console.log('Temporary pending account created and marked as unapproved in DB.');

    // Test 1: login with pending account (should be blocked)
    const loginPending = await makeRequest('/api/auth/login', 'POST', {
      email: tempPendingEmail,
      password: 'admin123!'
    });
    assert(loginPending.statusCode === 403, '1. Pending user login should be rejected with 403', loginPending);
    assert(loginPending.body.error && loginPending.body.error.includes('승인'), '1.1 Pending error message should mention approval/approval state', loginPending.body);

    // Test 2: login with wrong password
    const loginWrong = await makeRequest('/api/auth/login', 'POST', {
      email: 'wonzero@mz.co.kr',
      password: 'wrongpassword'
    });
    assert(loginWrong.statusCode === 401, '2. Login with wrong password should return 401', loginWrong);

    // Test 3: login with valid viewer account (wonzero@mz.co.kr, currently viewer role)
    const loginViewer = await makeRequest('/api/auth/login', 'POST', {
      email: 'wonzero@mz.co.kr',
      password: 'admin123!'
    });
    assert(loginViewer.statusCode === 200, '3. Viewer login should succeed with 200', loginViewer);
    
    const viewerCookie = getCookieHeader(loginViewer);
    assert(viewerCookie.includes('token='), '3.1 Login response should set token cookie', loginViewer.headers);

    // Test 4: Access solutions list with viewer token
    const viewSolutions = await makeRequest('/api/solutions', 'GET', null, { Cookie: viewerCookie });
    assert(viewSolutions.statusCode === 200, '4. Viewer can retrieve solutions list');
    assert(Array.isArray(viewSolutions.body), '4.1 Solution list body should be an array');
    
    // Check opinion removal (Policy B active initially)
    const openaiSol = viewSolutions.body.find(s => s.slug === 'openai-enterprise');
    assert(openaiSol !== undefined, '4.2 Found OpenAI Enterprise in solution list');
    assert(openaiSol.opinion === undefined, '4.3 Opinion field must be removed for Viewer');

    // Test 5: Try admin usage endpoint with viewer token (should be blocked)
    const viewerUsage = await makeRequest('/api/admin/usage', 'GET', null, { Cookie: viewerCookie });
    assert(viewerUsage.statusCode === 403, '5. Viewer accessing admin usage should return 403 Forbidden');

    // Test 6: login with admin account (admin@mz.co.kr)
    const loginAdmin = await makeRequest('/api/auth/login', 'POST', {
      email: 'admin@mz.co.kr',
      password: 'admin123!'
    });
    assert(loginAdmin.statusCode === 200, '6. Admin login should succeed with 200');
    
    const adminCookie = getCookieHeader(loginAdmin);

    // Test 7: Retrieve solutions with admin token
    const adminSolutions = await makeRequest('/api/solutions', 'GET', null, { Cookie: adminCookie });
    const openaiAdminSol = adminSolutions.body.find(s => s.slug === 'openai-enterprise');
    assert(openaiAdminSol !== undefined, '7. Admin can retrieve solutions list');
    assert(!openaiAdminSol.opinion.includes('Admin 전용 정보') && openaiAdminSol.opinion.includes('비즈니스 마진'), '7.1 Admin opinion field should NOT be masked and contain raw insights');

    // Test 8: Fetch admin usage with admin token
    const adminUsage = await makeRequest('/api/admin/usage', 'GET', null, { Cookie: adminCookie });
    assert(adminUsage.statusCode === 200, '8. Admin can access usage statistics');
    assert(adminUsage.body.totalLogs !== undefined, '8.1 Statistics should contain log indicators');

    // Test 9: Suggest edit via natural language
    const aiSuggest = await makeRequest('/api/admin/suggest-edit', 'POST', {
      solutionId: openaiAdminSol.id, // OpenAI Enterprise UUID
      prompt: 'OpenAI Enterprise 7번 체크리스트에 "MZC 프록시 검증" 항목을 추가해줘'
    }, { Cookie: adminCookie });
    assert(aiSuggest.statusCode === 200, '9. AI edit engine can propose changes');
    assert(aiSuggest.body.newContent.includes('MZC 프록시 검증'), '9.1 Proposed content must contain the prompt additions');
    assert(aiSuggest.body.oldContent !== aiSuggest.body.newContent, '9.2 Old and new contents should be different');

    // Test 10: Filter solutions by industry (should be empty array since industries are disabled/empty in v1)
    const manufacturingSolutions = await makeRequest('/api/solutions?industry=' + encodeURIComponent('제조'), 'GET', null, { Cookie: adminCookie });
    assert(manufacturingSolutions.statusCode === 200, '10. Can request filter by industry (제조)');
    assert(Array.isArray(manufacturingSolutions.body), '10.1 Industry filter response is an array');
    assert(manufacturingSolutions.body.length === 0, '10.2 Returned solutions should be empty for "제조" industry due to v1 deactivation');

    // Test 11: Filter solutions by simulator mapping
    const q1_1Solutions = await makeRequest('/api/solutions?simulator_mapping=q1_1', 'GET', null, { Cookie: adminCookie });
    assert(q1_1Solutions.statusCode === 200, '11. Can filter solutions by simulator mapping (q1_1)');
    assert(Array.isArray(q1_1Solutions.body), '11.1 Simulator mapping filter response is an array');
    const allHaveQ1_1 = q1_1Solutions.body.every(s => s.simulator_mappings && s.simulator_mappings.some(m => m.q === 'q1' && m.scenario.includes('20만 자')));
    assert(allHaveQ1_1, '11.2 All returned solutions should have "q1_1" scenario in simulator mappings');

    // ==================================================
    // ★ 추가 보안 요건 및 RLS 우회 대응 앱레벨 인가 검증
    // ==================================================
    console.log('--------------------------------------------------');
    console.log(' Running Security and Privilege Escalation Tests...');
    console.log('--------------------------------------------------');

    // Security Test 1: 권한 상승 우회 차단 검증 (회원 가입 트리거 취약점 테스트)
    const tempEmail = `test_escalation_${Date.now()}@mz.co.kr`;
    // Supabase Auth에 메타데이터를 포함해 가입 시도 (role/approved 권한 상승 시도)
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: tempEmail,
      password: 'temp1234password',
      options: {
        data: {
          role: 'admin',
          approved: true,
          full_name: '해커(Hacker)',
          team: 'IT Security'
        }
      }
    });

    if (signUpError) {
      console.log('[WARN] Auth signUp error (likely email verification is active or email limits):', signUpError.message);
    } else if (signUpData.user) {
      // profiles 테이블을 쿼리하여 role='viewer' 및 approved=false로 하드코딩 고정되었는지 확인
      const profRes = await pool.query('SELECT role, approved FROM profiles WHERE id = $1', [signUpData.user.id]);
      const prof = profRes.rows[0];
      
      assert(prof !== undefined, 'Sec 1. Profile automatically created via DB trigger');
      assert(prof.role === 'viewer', 'Sec 1.1 Trigger role ignored metadata and set always as "viewer"');
      assert(prof.approved === false, 'Sec 1.2 Trigger approved ignored metadata and set always as false');

      // 임시 테스트 유저 삭제
      await pool.query('DELETE FROM public.profiles WHERE id = $1', [signUpData.user.id]);
      await pool.query('DELETE FROM auth.users WHERE id = $1', [signUpData.user.id]);
      console.log('Cleaned up Sec 1 temporary signup user.');
    }

    // Security Test 2: Viewer 권한의 solutions 쓰기(POST/PUT) 시도 차단 검증
    const writeAttempt = await makeRequest('/api/admin/solutions', 'POST', {
      name: 'Hacked Solution',
      layer: 'L1'
    }, { Cookie: viewerCookie });
    assert(writeAttempt.statusCode === 403, 'Sec 2. Viewer POST writing solutions should be rejected with 403');

    const updateAttempt = await makeRequest('/api/admin/solutions/' + openaiSol.id, 'PUT', {
      name: 'Hacked OpenAI Enterprise',
      layer: 'L1'
    }, { Cookie: viewerCookie });
    assert(updateAttempt.statusCode === 403, 'Sec 2.1 Viewer PUT modifying solutions should be rejected with 403');

    const publishAttempt = await makeRequest('/api/admin/solutions/' + openaiSol.id + '/publish', 'POST', null, { Cookie: viewerCookie });
    assert(publishAttempt.statusCode === 403, 'Sec 2.2 Viewer publishing solutions should be rejected with 403');

    // Security Test 3: Viewer 응답에서 opinion 필드 노출 통제 검증 (완전 제거)
    const viewerOpiCheck = viewSolutions.body.every(s => {
      return s.opinion === undefined;
    });
    assert(viewerOpiCheck, 'Sec 3. Opinion field completely removed in list endpoint for Viewer');
 
    const viewerSingleSol = await makeRequest('/api/solutions/openai-enterprise', 'GET', null, { Cookie: viewerCookie });
    assert(viewerSingleSol.statusCode === 200, 'Sec 3.1 Viewer can access single solution');
    assert(viewerSingleSol.body.opinion === undefined, 'Sec 3.2 Single solution opinion is removed for Viewer');

    console.log('==================================================');
    console.log(` Verification Completed: ${successCount}/${testCount} tests passed.`);
    console.log('==================================================');
    
  } catch (err) {
    console.error('Error during test execution:', err);
  } finally {
    // 9. Teardown: 원복 및 임시 유저 삭제
    console.log('Starting Teardown...');
    try {
      // wonzero@mz.co.kr을 다시 admin 권한으로 원상복구
      await pool.query("UPDATE profiles SET role = 'admin', approved = true WHERE email = 'wonzero@mz.co.kr'");
      console.log('Restored wonzero@mz.co.kr profile back to admin.');
      
      // pending_test 계정 최종 삭제
      if (pendingUserId) {
        await pool.query("DELETE FROM public.profiles WHERE id = $1", [pendingUserId]);
        await pool.query("DELETE FROM auth.users WHERE id = $1", [pendingUserId]);
        console.log('Deleted temporary pending user from DB.');
      }
    } catch (teardownErr) {
      console.error('Error during teardown:', teardownErr);
    }
    
    await pool.end();
    if (successCount === testCount && testCount > 0) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

runTests();
