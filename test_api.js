const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

if (!process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('Missing required Supabase environment variables in .env for running test_api.js');
  process.exit(1);
}

if (!process.env.TEST_ADMIN_PASSWORD || !process.env.TEST_VIEWER_PASSWORD) {
  console.error('TEST_ADMIN_PASSWORD and TEST_VIEWER_PASSWORD are required for integration tests.');
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
  let tempSolId = null;

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
    
    // admin@mz.co.kr 및 dataai@mz.co.kr 계정 존재 확인
    const adminCheck = await pool.query("SELECT id FROM profiles WHERE email = 'admin@mz.co.kr'");
    const viewerCheck = await pool.query("SELECT id FROM profiles WHERE email = 'dataai@mz.co.kr'");
    
    if (adminCheck.rows.length === 0 || viewerCheck.rows.length === 0) {
      console.log('[WARN] Required test accounts (admin@mz.co.kr, dataai@mz.co.kr) not found in profiles. Please run seed/setup first.');
    } else {
      // 역할 및 승인 상태가 틀어져 있을 것에 대비해 강제 교정
      await pool.query("UPDATE profiles SET role = 'viewer', approved = true WHERE email = 'dataai@mz.co.kr'");
      await pool.query("UPDATE profiles SET role = 'admin', approved = true WHERE email = 'admin@mz.co.kr'");
      console.log('Test accounts (dataai as viewer, admin as admin) synced in profiles table.');
    }

    // 0-1. 미승인(pending) 임시 계정 생성
    console.log('Setting up temporary pending account...');
    await pool.query("DELETE FROM public.profiles WHERE email = $1", [tempPendingEmail]);
    await pool.query("DELETE FROM auth.users WHERE email = $1", [tempPendingEmail]);

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(process.env.TEST_ADMIN_PASSWORD, salt);

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

    await pool.query(`
      UPDATE public.profiles
      SET role = 'viewer', approved = false, full_name = '대기사용자', team = 'Test Team'
      WHERE id = $1
    `, [pendingUserId]);
    console.log('Temporary pending account created.');

    // Test 1: login with pending account (should be blocked)
    const loginPending = await makeRequest('/api/auth/login', 'POST', {
      email: tempPendingEmail,
      password: process.env.TEST_ADMIN_PASSWORD
    });
    assert(loginPending.statusCode === 403, '1. Pending user login should be rejected with 403', loginPending);
    assert(loginPending.body.error && loginPending.body.error.includes('승인'), '1.1 Pending error message should mention approval state', loginPending.body);

    // Test 2: login with wrong password
    const loginWrong = await makeRequest('/api/auth/login', 'POST', {
      email: 'dataai@mz.co.kr',
      password: `${process.env.TEST_VIEWER_PASSWORD}-invalid`
    });
    assert(loginWrong.statusCode === 401, '2. Login with wrong password should return 401', loginWrong);

    // Test 3: login with valid viewer account (dataai@mz.co.kr)
    const loginViewer = await makeRequest('/api/auth/login', 'POST', {
      email: 'dataai@mz.co.kr',
      password: process.env.TEST_VIEWER_PASSWORD
    });
    assert(loginViewer.statusCode === 200, '3. Viewer login should succeed with 200', loginViewer);
    
    const viewerCookie = getCookieHeader(loginViewer);
    assert(viewerCookie.includes('token='), '3.1 Login response should set token cookie', loginViewer.headers);

    // Test 4: Access solutions list with viewer token
    const viewSolutions = await makeRequest('/api/solutions', 'GET', null, { Cookie: viewerCookie });
    assert(viewSolutions.statusCode === 200, '4. Viewer can retrieve solutions list');
    assert(Array.isArray(viewSolutions.body), '4.1 Solution list body should be an array');
    
    const openaiSol = viewSolutions.body.find(s => s.slug === 'openai-enterprise');
    assert(openaiSol !== undefined, '4.2 Found OpenAI Enterprise in solution list');
    assert(openaiSol.opinion === undefined, '4.3 Opinion field must be removed for Viewer');

    // Test 5: Try admin usage endpoint with viewer token (should be blocked)
    const viewerUsage = await makeRequest('/api/admin/usage', 'GET', null, { Cookie: viewerCookie });
    assert(viewerUsage.statusCode === 403, '5. Viewer accessing admin usage should return 403 Forbidden');

    // Test 6: login with admin account (admin@mz.co.kr)
    const loginAdmin = await makeRequest('/api/auth/login', 'POST', {
      email: 'admin@mz.co.kr',
      password: process.env.TEST_ADMIN_PASSWORD
    });
    assert(loginAdmin.statusCode === 200, '6. Admin login should succeed with 200');
    
    const adminCookie = getCookieHeader(loginAdmin);

    // Test 7: Retrieve solutions with admin token
    const adminSolutions = await makeRequest('/api/solutions', 'GET', null, { Cookie: adminCookie });
    const openaiAdminSol = adminSolutions.body.find(s => s.slug === 'openai-enterprise');
    assert(openaiAdminSol !== undefined, '7. Admin can retrieve solutions list');
    assert(!openaiAdminSol.opinion.includes('Admin 전용 정보') && openaiAdminSol.opinion.includes('비즈니스 마진'), '7.1 Admin opinion field should NOT be masked');

    // Test 8: Fetch admin usage with admin token
    const adminUsage = await makeRequest('/api/admin/usage', 'GET', null, { Cookie: adminCookie });
    assert(adminUsage.statusCode === 200, '8. Admin can access usage statistics');
    assert(adminUsage.body.totalLogs !== undefined, '8.1 Statistics should contain log indicators');

    // Test 9: Suggest edit via natural language
    const aiSuggest = await makeRequest('/api/admin/suggest-edit', 'POST', {
      solutionId: openaiAdminSol.id,
      prompt: 'OpenAI Enterprise 7번 체크리스트에 "MZC 프록시 검증" 항목을 추가해줘'
    }, { Cookie: adminCookie });
    assert(aiSuggest.statusCode === 200, '9. AI edit engine can propose changes');
    assert(aiSuggest.body.newContent.includes('MZC 프록시 검증'), '9.1 Proposed content must contain the prompt additions');
    assert(aiSuggest.body.oldContent !== aiSuggest.body.newContent, '9.2 Old and new contents should be different');

    // Test 10: Filter solutions by industry
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
    // ★ 솔루션 아카이브(삭제) 기능 검증 추가 (Test 12)
    // ==================================================
    console.log('--------------------------------------------------');
    console.log(' Running Solution Archive & Soft Delete Tests...');
    console.log('--------------------------------------------------');

    // 1. 임시 테스트용 솔루션 생성 (Admin 토큰)
    const tempSolName = `Temp_Archive_Test_Isv_${Date.now()}`;
    const createTempSol = await makeRequest('/api/admin/solutions', 'POST', {
      name: tempSolName,
      layer: 'L1',
      delivery: 'SaaS',
      synergy: '보통',
      category: 'Test',
      status: 'published'
    }, { Cookie: adminCookie });
    
    assert(createTempSol.statusCode === 200, '12.1 Created temporary solution for archiving', createTempSol);
    tempSolId = createTempSol.body.id;
    const tempSolSlug = createTempSol.body.slug;

    // 1.1 관리자 목록에서 조회되는지 확인 (Draft 상태이므로 관리자 목록에서 조회 가능해야 함)
    const checkBeforeArchive = await makeRequest('/api/solutions', 'GET', null, { Cookie: adminCookie });
    const foundBefore = checkBeforeArchive.body.some(s => s.id === tempSolId);
    assert(foundBefore === true, '12.2 Temporary solution is visible before archiving');

    // 2. 일반 뷰어 권한으로 아카이브(DELETE) 시도 -> 403 Forbidden 확인
    const illegalArchive = await makeRequest(`/api/admin/solutions/${tempSolId}`, 'DELETE', null, { Cookie: viewerCookie });
    assert(illegalArchive.statusCode === 403, '12.3 Viewer DELETE request should be blocked with 403');

    // 3. 어드민 권한으로 아카이브(DELETE) 처리 -> 200 OK 확인
    const archiveRes = await makeRequest(`/api/admin/solutions/${tempSolId}`, 'DELETE', null, { Cookie: adminCookie });
    assert(archiveRes.statusCode === 200, '12.4 Admin DELETE request returns 200 OK');

    // 4. 일반 사용자 및 어드민 목록에서 더 이상 조회되지 않는지 검증
    const viewerCheckAfter = await makeRequest('/api/solutions', 'GET', null, { Cookie: viewerCookie });
    const foundViewerAfter = viewerCheckAfter.body.some(s => s.id === tempSolId);
    assert(foundViewerAfter === false, '12.5 Archived solution is hidden from Viewer list');

    const adminCheckAfter = await makeRequest('/api/solutions', 'GET', null, { Cookie: adminCookie });
    const foundAdminAfter = adminCheckAfter.body.some(s => s.id === tempSolId);
    assert(foundAdminAfter === false, '12.6 Archived solution is hidden from Admin list');

    // 5. 상세 조회 API 에서도 차단되는지 검증
    const detailCheckAfter = await makeRequest(`/api/solutions/${tempSolSlug}`, 'GET', null, { Cookie: adminCookie });
    assert(detailCheckAfter.statusCode === 404, '12.7 Archived solution details return 404 Not Found');

    // ==================================================
    // ★ 추가 보안 요건 및 RLS 우회 대응 앱레벨 인가 검증
    // ==================================================
    console.log('--------------------------------------------------');
    console.log(' Running Security and Privilege Escalation Tests...');
    console.log('--------------------------------------------------');

    // Security Test 1: 권한 상승 우회 차단 검증 (회원 가입 트리거 취약점 테스트)
    const tempEmail = `test_escalation_${Date.now()}@mz.co.kr`;
    const tempId = crypto.randomUUID();
    const hackerHash = bcrypt.hashSync('hacker123!', bcrypt.genSaltSync(10));
    
    try {
      // Supabase Auth 회원가입 API 대신 직접 DB에 해킹 메타데이터를 밀어 넣어 트리거 실행 검증 (Rate Limit 우회)
      await pool.query(`
        INSERT INTO auth.users (
          id, instance_id, aud, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, is_super_admin, role,
          created_at, updated_at
        )
        VALUES (
          $1, '00000000-0000-0000-0000-000000000000', 'authenticated', $2, $3, now(),
          '{"provider":"email","providers":["email"]}'::jsonb, 
          '{"role":"admin","approved":true,"full_name":"해커(Hacker)","team":"IT Security"}'::jsonb, 
          false, 'authenticated', now(), now()
        )
      `, [tempId, tempEmail, hackerHash]);

      const profRes = await pool.query('SELECT role, approved FROM profiles WHERE id = $1', [tempId]);
      const prof = profRes.rows[0];
      
      assert(prof !== undefined, 'Sec 1. Profile automatically created via DB trigger');
      assert(prof.role === 'viewer', 'Sec 1.1 Trigger role ignored metadata and set always as "viewer"');
      assert(prof.approved === false, 'Sec 1.2 Trigger approved ignored metadata and set always as false');

      await pool.query('DELETE FROM public.profiles WHERE id = $1', [tempId]);
      await pool.query('DELETE FROM auth.users WHERE id = $1', [tempId]);
      console.log('Cleaned up Sec 1 temporary signup user.');
    } catch (dbErr) {
      console.error('Failed to execute Sec 1 trigger test via DB INSERT:', dbErr);
      assert(false, 'Sec 1. DB trigger verification failed due to SQL error');
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
    console.log('Starting Teardown...');
    try {
      // 1. 임시 pending 계정 삭제
      if (pendingUserId) {
        await pool.query("DELETE FROM public.profiles WHERE id = $1", [pendingUserId]);
        await pool.query("DELETE FROM auth.users WHERE id = $1", [pendingUserId]);
        console.log('Deleted temporary pending user from DB.');
      }
      // 2. 임시 생성한 아카이브 검사용 솔루션 영구 삭제
      if (tempSolId) {
        await pool.query("DELETE FROM public.solutions WHERE id = $1", [tempSolId]);
        console.log('Deleted temporary solution from DB.');
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
