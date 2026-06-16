const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
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

  try {
    // 0. Setup/Check database test accounts
    // Supabase Auth에 테스트 계정이 잘 가입되어 있는지 확인 및 권한 강제 조율
    console.log('Checking test accounts sync...');
    
    // admin@mzc.co.kr 프로필 조회
    const adminCheck = await pool.query("SELECT id FROM profiles WHERE email = 'admin@mzc.co.kr'");
    if (adminCheck.rows.length === 0) {
      console.log('[WARN] admin@mzc.co.kr profile not found. Please ensure users are created in Supabase Auth first.');
    } else {
      await pool.query("UPDATE profiles SET role = 'admin', approved = true WHERE email = 'admin@mzc.co.kr'");
      await pool.query("UPDATE profiles SET role = 'viewer', approved = true WHERE email = 'viewer@mzc.co.kr'");
      await pool.query("UPDATE profiles SET role = 'viewer', approved = false WHERE email = 'pending@mzc.co.kr'");
      console.log('Test accounts sync updated in profiles table.');
    }

    // Test 1: login with pending account (should be blocked)
    const loginPending = await makeRequest('/api/auth/login', 'POST', {
      email: 'pending@mzc.co.kr',
      password: 'vudckdWlq1!'
    });
    assert(loginPending.statusCode === 403, '1. Pending user login should be rejected with 403', loginPending);
    assert(loginPending.body.error && loginPending.body.error.includes('승인'), '1.1 Pending error message should mention approval/approval state', loginPending.body);

    // Test 2: login with wrong password
    const loginWrong = await makeRequest('/api/auth/login', 'POST', {
      email: 'viewer@mzc.co.kr',
      password: 'wrongpassword'
    });
    assert(loginWrong.statusCode === 401, '2. Login with wrong password should return 401', loginWrong);

    // Test 3: login with valid viewer account
    const loginViewer = await makeRequest('/api/auth/login', 'POST', {
      email: 'viewer@mzc.co.kr',
      password: 'vudckdWlq1!'
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

    // Test 6: login with admin account
    const loginAdmin = await makeRequest('/api/auth/login', 'POST', {
      email: 'admin@mzc.co.kr',
      password: 'vudckdWlq1!'
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
    assert(manufacturingSolutions.body.length === 0, '10.2 All returned solutions should be empty for "제조" industry due to v1 deactivation');

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
    const tempEmail = `test_escalation_${Date.now()}@mzc.co.kr`;
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
      await pool.query('DELETE FROM profiles WHERE id = $1', [signUpData.user.id]);
      // Supabase Auth의 유저 삭제는 admin API가 필요하므로 profiles만 우선 삭제해둠
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
      // B 정책일 때 viewer는 절대 opinion 필드를 갖지 않아야 함
      return s.opinion === undefined;
    });
    assert(viewerOpiCheck, 'Sec 3. Opinion field completely removed in list endpoint for Viewer');
 
    const viewerSingleSol = await makeRequest('/api/solutions/openai-enterprise', 'GET', null, { Cookie: viewerCookie });
    assert(viewerSingleSol.statusCode === 200, 'Sec 3.1 Viewer can access single solution');
    assert(viewerSingleSol.body.opinion === undefined, 'Sec 3.2 Single solution opinion is removed for Viewer');

    console.log('==================================================');
    console.log(` Verification Completed: ${successCount}/${testCount} tests passed.`);
    console.log('==================================================');
    
    await pool.end();
    if (successCount === testCount) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('Error during test execution:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

runTests();
