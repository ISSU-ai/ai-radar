const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dns = require('dns');
dns.setDefaultResultOrder('verbatim');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is missing in .env file.');
  process.exit(1);
}

let poolConfig = {
  ssl: { rejectUnauthorized: false }
};

if (process.env.DATABASE_URL) {
  if (process.env.DATABASE_URL.includes('db.dfbxqjjdkaflsihikogw.supabase.co')) {
    poolConfig.host = '2406:da12:557:f802:f1e4:3665:9254:d0dc';
    poolConfig.port = 5432;
    poolConfig.user = 'postgres';
    poolConfig.password = 'vudckdWlq1!';
    poolConfig.database = 'postgres';
  } else {
    poolConfig.connectionString = process.env.DATABASE_URL;
  }
}

const pool = new Pool(poolConfig);

// app.js의 simulatorStepsData 구조 복사
const simulatorStepsData = {
  q1: {
    title: " 전사 임직원 생산성 향상 관련 고민",
    options: [
      { text: "보안이 극도로 강한 규제 산업 환경이며 20만 자 이상의 분석이 필요합니다.", recommendations: ["Anthropic", "LiteLLM"] },
      { text: "이미 구글 워크스페이스 환경을 사용하고 있어, 긴밀한 오피스 연동을 원합니다.", recommendations: ["Gemini Workspace", "OpenAI Enterprise"] },
      { text: "시장 표준 챗봇과 풍부한 노코드 확장 플랫폼(GPTs)을 선호합니다.", recommendations: ["OpenAI Enterprise", "LiteLLM"] },
      { text: "한국어 성능이 우수하고 국내 소버린 AI 인프라 자가 구축이 목적입니다.", recommendations: ["NC AI", "MZC AIR Platform"] },
      { text: "종합적 AI/ML 인프라와 강력한 엔터프라이즈 AI 거버넌스를 희망합니다.", recommendations: ["IBM", "Databricks"] }
    ]
  },
  q2: {
    title: " 특정 부서 업무 자동화 관련 고민",
    options: [
      { text: "보안상 외부 인터넷 망 연결이 100% 차단된 내부망(에어갭) 환경이 필수적입니다.", recommendations: ["Articul8", "MZC AIR Platform"] },
      { text: "IT 운영 관리(ITSM)나 인사(HR) 등 백오피스 통합 워크플로우를 혁신하고 싶습니다.", recommendations: ["ServiceNow AI", "Salesforce AgentForce"] },
      { text: "영업 파이프라인 관리 및 대고객 마케팅 대응 자동화를 추진하고 싶습니다.", recommendations: ["Salesforce AgentForce", "ServiceNow AI"] },
      { text: "공급망 관리(SCM), 재무 예측 등 전사 ERP 기반 분석 및 자동화가 필요합니다.", recommendations: ["SAP Joule", "Databricks"] },
      { text: "다국어 동영상 파일의 인물/동작 자연어 검색 및 시점 요약이 필요합니다.", recommendations: ["TwelveLabs", "ElevenLabs"] },
      { text: "고객 문의 응대를 위해 정밀한 AI 음성 및 보이스 에이전트를 구축하고자 합니다.", recommendations: ["ElevenLabs", "TwelveLabs"] },
      { text: "금융 리서치 및 컴플라이언스(준법감시)를 자동 보조할 전문 금융 에이전트를 원합니다.", recommendations: ["Unique", "Anthropic"] },
      { text: "게임, 이커머스 제작에 필요한 3D 에셋 그래픽 생성을 자동화하고 싶습니다.", recommendations: ["MeshyAI", "OpenAI Enterprise"] }
    ]
  },
  q3: {
    title: " 개발자 및 데이터 과학자 지원 관련 고민",
    options: [
      { text: "가벼운 웹 브라우저 기반 코딩 환경과 간편한 AI 개발 협업 도구를 원합니다.", recommendations: ["Replit", "Posit (RStudio)"] },
      { text: "현업 분석가(Citizen DS)가 코딩 없이 ML 예측 알고리즘을 학습하고 운영하고자 합니다.", recommendations: ["Dataiku", "DataRobot"] },
      { text: "R/Python 기반의 과학적 통계 분석 및 정밀 통계 웹 보고서 배포 플랫폼이 필요합니다.", recommendations: ["Posit (RStudio)", "Anaconda"] },
      { text: "파이썬 패키지 공급망 전반의 보안 취약점과 거버넌스를 완벽히 제어하고 싶습니다.", recommendations: ["Anaconda", "Dataiku"] },
      { text: "오픈소스 데이터분석 워크플로우를 노코드로 설계하여 파이프라인을 구축하고자 합니다.", recommendations: ["KNIME", "Fivetran"] }
    ]
  },
  q4: {
    title: " 에이전트 제어 및 LLM 비용 통제 관련 고민",
    options: [
      { text: "장시간 구동되는 에이전트의 중단 장애 발생 시 자가 치유와 상태 보존이 필수입니다.", recommendations: ["Temporal", "MZC AIR Platform"] },
      { text: "MZC 표준 프레임워크를 기반으로 멀티 LLM 제어 및 에이전트 조립을 조율하고 싶습니다.", recommendations: ["MZC AIR Platform", "LiteLLM"] },
      { text: "사내 API 호출 비용 모니터링, 가상키 할당 및 다중 모델 비용 최적화 라우팅이 시급합니다.", recommendations: ["LiteLLM", "MZC AIR Platform"] }
    ]
  },
  q0: {
    title: " 데이터 레이크/DW 기반 AI 연동 관련 고민",
    options: [
      { text: "데이터 레이크와 ML, GenAI(Mosaic) 개발 전체를 단일 플랫폼으로 통합하고 싶습니다.", recommendations: ["Databricks", "Snowflake"] },
      { text: "클라우드 데이터 웨어하우스(DW) 내 데이터를 복제 없이 Cortex AI와 연동해 쓰고 싶습니다.", recommendations: ["Snowflake", "Databricks"] },
      { text: "사일로화된 분산 데이터를 물리적으로 복제하지 않고 RAG에 실시간 가상 연결하고 싶습니다.", recommendations: ["Denodo", "Informatica"] },
      { text: "정제되고 거버넌스가 확보된 전사 마스터 데이터(MDM)를 AI 솔루션에 동반 연계하고 싶습니다.", recommendations: ["Informatica", "Denodo"] },
      { text: "기존의 하이브리드/온프레미스 데이터레이크(Hadoop 등) 환경 위에 AI RAG를 얹고 싶습니다.", recommendations: ["Cloudera", "IBM"] },
      { text: "이기종 데이터 소스들(수백 개 이상)을 DW/분석마트로 실시간 자동 ELT 적재하고 싶습니다.", recommendations: ["Fivetran", "Trocco"] }
    ]
  },
  q4_q0: {
    title: " 벡터 저장소 및 실시간 RAG 구성 관련 고민",
    options: [
      { text: "RAG 지연속도와 비용을 획기적으로 낮출 벡터검색 및 세맨틱 캐시 레이어가 필요합니다.", recommendations: ["Redis", "Pinecone"] },
      { text: "실시간 이벤트 스트리밍(Kafka) 데이터를 지체 없이 가공해 RAG 데이터로 밀어넣고 싶습니다.", recommendations: ["Confluent", "Redis"] },
      { text: "초대형 RAG 인프라 환경에서 대규모 운영 NoSQL 데이터베이스와 벡터검색을 통합 운영하고 싶습니다.", recommendations: ["Datastax", "Couchbase"] },
      { text: "기존 관계형 DB(PostgreSQL) 자산을 고스란히 활용해 벡터 스토어를 겸용하고 싶습니다.", recommendations: ["EDB (PSQL)", "Redis"] },
      { text: "단순 벡터 검색으로 해결 불가능한 복잡한 다단계 관계형 지식 그래프(GraphRAG)를 연계하고 싶습니다.", recommendations: ["Tigergraph", "Databricks"] }
    ]
  }
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// 이름 alias(정규화 키 -> DB 솔루션명)
const aliasMap = {
  "anthropic": "Anthropic Claude"
};

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Loading isv_data.js...');
    const isvDataPath = path.join(__dirname, 'isv_data.js');
    if (!fs.existsSync(isvDataPath)) {
      throw new Error(`isv_data.js not found at ${isvDataPath}`);
    }

    const isvDataContent = fs.readFileSync(isvDataPath, 'utf8');
    
    // Parse isvData array from JS file securely
    const tempModuleName = `temp_isv_data_${Date.now()}.js`;
    const tempModulePath = path.join(__dirname, tempModuleName);
    const moduleContent = isvDataContent.replace(/const isvData\s*=/, 'module.exports =');
    fs.writeFileSync(tempModulePath, moduleContent, 'utf8');
    
    const isvData = require(tempModulePath);
    fs.unlinkSync(tempModulePath);

    // 필터링 없이 총 18개 전체 솔루션 적재 대상 지정
    const filteredSolutions = isvData;
    console.log(`Found ${filteredSolutions.length} solutions to seed in Supabase...`);

    // 추천명을 통한 솔루션 찾기 함수
    function findSolutionForRecommendation(recName) {
      const normRec = norm(recName);
      const targetName = aliasMap[normRec] || recName;
      const normTarget = norm(targetName);
      return filteredSolutions.find(sol => norm(sol.name) === normTarget);
    }

    // 1. simulator_mappings 역매핑 맵 구성
    const slugToSimulatorMappings = {};
    filteredSolutions.forEach(isv => {
      const slug = isv.slug || isv.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      slugToSimulatorMappings[slug] = [];
    });

    // simulatorStepsData 역매핑 재계산 실행
    for (const [qKey, qVal] of Object.entries(simulatorStepsData)) {
      qVal.options.forEach((opt) => {
        opt.recommendations.forEach((recName, idx) => {
          const matchedSol = findSolutionForRecommendation(recName);
          if (matchedSol) {
            const slug = matchedSol.slug || matchedSol.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const rank = idx + 1;
            const alreadyExists = slugToSimulatorMappings[slug].some(m => m.q === qKey && m.scenario === opt.text);
            if (!alreadyExists) {
              slugToSimulatorMappings[slug].push({
                q: qKey,
                question: qVal.title.trim(),
                scenario: opt.text,
                rank: rank
              });
            }
          }
        });
      });
    }

    const now = new Date().toISOString();

    for (const isv of filteredSolutions) {
      const slug = isv.slug || isv.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const sectionsJson = JSON.stringify(isv.sections || {});

      // simulator_mappings와 industries 자동 계산
      const simulatorMappings = slugToSimulatorMappings[slug] || [];
      // 파싱 신뢰도가 낮으므로 industries는 []로 둔다.
      const industries = [];

      console.log(`Seeding ${isv.name} (slug: ${slug}) -> mappings: ${simulatorMappings.length}, industries: ${industries.length}`);

      // Supabase solutions 업서트 실행
      const upsertQuery = `
        INSERT INTO solutions (
          legacy_id, slug, name, delivery, layer, synergy, category, jtbd, value_chain, sections, opinion, status, version, updated_at, simulator_mappings, industries
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'published', 1, $12, $13, $14)
        ON CONFLICT (slug) DO UPDATE
        SET 
          legacy_id = EXCLUDED.legacy_id,
          name = EXCLUDED.name,
          delivery = EXCLUDED.delivery,
          layer = EXCLUDED.layer,
          synergy = EXCLUDED.synergy,
          category = EXCLUDED.category,
          jtbd = EXCLUDED.jtbd,
          value_chain = EXCLUDED.value_chain,
          sections = EXCLUDED.sections,
          opinion = EXCLUDED.opinion,
          updated_at = EXCLUDED.updated_at,
          simulator_mappings = EXCLUDED.simulator_mappings,
          industries = EXCLUDED.industries
        RETURNING id;
      `;

      const res = await client.query(upsertQuery, [
        isv.id,
        slug,
        isv.name,
        isv.delivery || 'N/A',
        isv.layer,
        isv.synergy || '보통',
        isv.category || 'N/A',
        isv.jtbd || '',
        isv.value_chain || 'N/A',
        sectionsJson,
        isv.opinion || '',
        now,
        JSON.stringify(simulatorMappings),
        JSON.stringify(industries)
      ]);

      const solutionId = res.rows[0].id;

      // 버전 테이블 업서트 (최근 1버전 히스토리 기록용)
      const snapshot = JSON.stringify({
        slug,
        name: isv.name,
        delivery: isv.delivery || 'N/A',
        layer: isv.layer,
        synergy: isv.synergy || '보통',
        category: isv.category || 'N/A',
        jtbd: isv.jtbd || '',
        value_chain: isv.value_chain || 'N/A',
        sections: isv.sections || {},
        opinion: isv.opinion || '',
        status: 'published',
        version: 1,
        simulator_mappings: simulatorMappings,
        industries: industries
      });

      const checkVerRes = await client.query(
        'SELECT id FROM solution_versions WHERE solution_id = $1 AND (snapshot->>\'version\')::int = 1',
        [solutionId]
      );

      if (checkVerRes.rows.length === 0) {
        await client.query(`
          INSERT INTO solution_versions (solution_id, snapshot, editor, created_at)
          VALUES ($1, $2, null, $3)
        `, [solutionId, snapshot, now]);
      } else {
        await client.query(`
          UPDATE solution_versions
          SET snapshot = $2, created_at = $3
          WHERE solution_id = $1 AND (snapshot->>\'version\')::int = 1
        `, [solutionId, snapshot, now]);
      }
    }

    console.log('Solutions and initial versions seeded successfully to Supabase.');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    client.release();
    await pool.end();
    console.log('Database connection closed.');
  }
}

seed();
