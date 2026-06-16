// ----------------------------------------------------
// Simulator Data Definition
// ----------------------------------------------------
const simulatorStepsData = {
  q1: {
    title: " 전사 임직원 생산성 향상 관련 고민",
    options: [
      {
        text: "보안이 극도로 강한 규제 산업 환경이며 20만 자 이상의 분석이 필요합니다.",
        recommendations: ["Anthropic", "LiteLLM"]
      },
      {
        text: "이미 구글 워크스페이스 환경을 사용하고 있어, 긴밀한 오피스 연동을 원합니다.",
        recommendations: ["Gemini Workspace", "OpenAI Enterprise"]
      },
      {
        text: "시장 표준 챗봇과 풍부한 노코드 확장 플랫폼(GPTs)을 선호합니다.",
        recommendations: ["OpenAI Enterprise", "LiteLLM"]
      },
      {
        text: "한국어 성능이 우수하고 국내 소버린 AI 인프라 자가 구축이 목적입니다.",
        recommendations: ["NC AI", "MZC AIR Platform"]
      },
      {
        text: "종합적 AI/ML 인프라와 강력한 엔터프라이즈 AI 거버넌스를 희망합니다.",
        recommendations: ["IBM", "Databricks"]
      }
    ]
  },
  q2: {
    title: " 특정 부서 업무 자동화 관련 고민",
    options: [
      {
        text: "보안상 외부 인터넷 망 연결이 100% 차단된 내부망(에어갭) 환경이 필수적입니다.",
        recommendations: ["Articul8", "MZC AIR Platform"]
      },
      {
        text: "IT 운영 관리(ITSM)나 인사(HR) 등 백오피스 통합 워크플로우를 혁신하고 싶습니다.",
        recommendations: ["ServiceNow AI", "Salesforce AgentForce"]
      },
      {
        text: "영업 파이프라인 관리 및 대고객 마케팅 대응 자동화를 추진하고 싶습니다.",
        recommendations: ["Salesforce AgentForce", "ServiceNow AI"]
      },
      {
        text: "공급망 관리(SCM), 재무 예측 등 전사 ERP 기반 분석 및 자동화가 필요합니다.",
        recommendations: ["SAP Joule", "Databricks"]
      },
      {
        text: "다국어 동영상 파일의 인물/동작 자연어 검색 및 시점 요약이 필요합니다.",
        recommendations: ["TwelveLabs", "ElevenLabs"]
      },
      {
        text: "고객 문의 응대를 위해 정밀한 AI 음성 및 보이스 에이전트를 구축하고자 합니다.",
        recommendations: ["ElevenLabs", "TwelveLabs"]
      },
      {
        text: "금융 리서치 및 컴플라이언스(준법감시)를 자동 보조할 전문 금융 에이전트를 원합니다.",
        recommendations: ["Unique", "Anthropic"]
      },
      {
        text: "게임, 이커머스 제작에 필요한 3D 에셋 그래픽 생성을 자동화하고 싶습니다.",
        recommendations: ["MeshyAI", "OpenAI Enterprise"]
      }
    ]
  },
  q3: {
    title: " 개발자 및 데이터 과학자 지원 관련 고민",
    options: [
      {
        text: "가벼운 웹 브라우저 기반 코딩 환경과 간편한 AI 개발 협업 도구를 원합니다.",
        recommendations: ["Replit", "Posit (RStudio)"]
      },
      {
        text: "현업 분석가(Citizen DS)가 코딩 없이 ML 예측 알고리즘을 학습하고 운영하고자 합니다.",
        recommendations: ["Dataiku", "DataRobot"]
      },
      {
        text: "R/Python 기반의 과학적 통계 분석 및 정밀 통계 웹 보고서 배포 플랫폼이 필요합니다.",
        recommendations: ["Posit (RStudio)", "Anaconda"]
      },
      {
        text: "파이썬 패키지 공급망 전반의 보안 취약점과 거버넌스를 완벽히 제어하고 싶습니다.",
        recommendations: ["Anaconda", "Dataiku"]
      },
      {
        text: "오픈소스 데이터분석 워크플로우를 노코드로 설계하여 파이프라인을 구축하고자 합니다.",
        recommendations: ["KNIME", "Fivetran"]
      }
    ]
  },
  q4: {
    title: " 에이전트 제어 및 LLM 비용 통제 관련 고민",
    options: [
      {
        text: "장시간 구동되는 에이전트의 중단 장애 발생 시 자가 치유와 상태 보존이 필수입니다.",
        recommendations: ["Temporal", "MZC AIR Platform"]
      },
      {
        text: "MZC 표준 프레임워크를 기반으로 멀티 LLM 제어 및 에이전트 조립을 조율하고 싶습니다.",
        recommendations: ["MZC AIR Platform", "LiteLLM"]
      },
      {
        text: "사내 API 호출 비용 모니터링, 가상키 할당 및 다중 모델 비용 최적화 라우팅이 시급합니다.",
        recommendations: ["LiteLLM", "MZC AIR Platform"]
      }
    ]
  },
  q0: {
    title: " 데이터 레이크/DW 기반 AI 연동 관련 고민",
    options: [
      {
        text: "데이터 레이크와 ML, GenAI(Mosaic) 개발 전체를 단일 플랫폼으로 통합하고 싶습니다.",
        recommendations: ["Databricks", "Snowflake"]
      },
      {
        text: "클라우드 데이터 웨어하우스(DW) 내 데이터를 복제 없이 Cortex AI와 연동해 쓰고 싶습니다.",
        recommendations: ["Snowflake", "Databricks"]
      },
      {
        text: "사일로화된 분산 데이터를 물리적으로 복제하지 않고 RAG에 실시간 가상 연결하고 싶습니다.",
        recommendations: ["Denodo", "Informatica"]
      },
      {
        text: "정제되고 거버넌스가 확보된 전사 마스터 데이터(MDM)를 AI 솔루션에 동반 연계하고 싶습니다.",
        recommendations: ["Informatica", "Denodo"]
      },
      {
        text: "기존의 하이브리드/온프레미스 데이터레이크(Hadoop 등) 환경 위에 AI RAG를 얹고 싶습니다.",
        recommendations: ["Cloudera", "IBM"]
      },
      {
        text: "이기종 데이터 소스들(수백 개 이상)을 DW/분석마트로 실시간 자동 ELT 적재하고 싶습니다.",
        recommendations: ["Fivetran", "Trocco"]
      }
    ]
  },
  q4_q0: {
    title: " 벡터 저장소 및 실시간 RAG 구성 관련 고민",
    options: [
      {
        text: "RAG 지연속도와 비용을 획기적으로 낮출 벡터검색 및 세맨틱 캐시 레이어가 필요합니다.",
        recommendations: ["Redis", "Pinecone"]
      },
      {
        text: "실시간 이벤트 스트리밍(Kafka) 데이터를 지체 없이 가공해 RAG 데이터로 밀어넣고 싶습니다.",
        recommendations: ["Confluent", "Redis"]
      },
      {
        text: "초대형 RAG 인프라 환경에서 대규모 운영 NoSQL 데이터베이스와 벡터검색을 통합 운영하고 싶습니다.",
        recommendations: ["Datastax", "Couchbase"]
      },
      {
        text: "기존 관계형 DB(PostgreSQL) 자산을 고스란히 활용해 벡터 스토어를 겸용하고 싶습니다.",
        recommendations: ["EDB (PSQL)", "Redis"]
      },
      {
        text: "단순 벡터 검색으로 해결 불가능한 복잡한 다단계 관계형 지식 그래프(GraphRAG)를 연계하고 싶습니다.",
        recommendations: ["Tigergraph", "Databricks"]
      }
    ]
  }
};

// State variables
let isvData = [];
let currentSelectedIsv = null;
let currentActiveTab = "1";
let currentUser = null;

// Init Page
window.addEventListener("DOMContentLoaded", () => {
  loadDashboardData();
});

// Load Dashboard Data & Auth status
async function loadDashboardData() {
  try {
    // 1. Fetch current user session
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) {
      window.location.href = '/login.html';
      return;
    }
    const meData = await meRes.json();
    currentUser = meData.user;
    
    // Update Session Bar UI
    document.getElementById('session-username').textContent = currentUser.name;
    document.getElementById('session-email').textContent = currentUser.email;
    
    const roleBadge = document.getElementById('session-role-badge');
    roleBadge.textContent = currentUser.role === 'admin' ? 'Admin' : 'Viewer';
    if (currentUser.role === 'admin') {
      roleBadge.style.color = 'var(--accent-purple)';
      roleBadge.style.background = 'rgba(168, 85, 247, 0.15)';
      document.getElementById('admin-btn').classList.remove('hidden');
    } else {
      roleBadge.style.color = 'var(--accent-blue)';
      roleBadge.style.background = 'rgba(14, 165, 233, 0.15)';
    }

    // 2. Fetch all solutions
    const solRes = await fetch('/api/solutions');
    if (!solRes.ok) throw new Error('솔루션 데이터를 가져올 수 없습니다.');
    isvData = await solRes.json();

    // 3. Render components
    lucide.createIcons();
    renderMatrixTags();
    renderISVTable(isvData);
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

// Handle Logout
async function handleLogout() {
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    if (res.ok) {
      window.location.href = '/login.html';
    }
  } catch (err) {
    console.error('Logout failed:', err);
  }
}

// ----------------------------------------------------
// 1. Simulator Logic
// ----------------------------------------------------
function nextStep(step, val) {
  if (step === 1) {
    const data = simulatorStepsData[val];
    const step2Q = document.getElementById("step-2-q");
    const step2Opts = document.getElementById("step-2-options");
    
    step2Q.innerHTML = `<i data-lucide="help-circle"></i> ${data.title}의 세부 요구사항을 선택해 주세요.`;
    
    // populate step 2 options
    let html = "";
    data.options.forEach((opt, idx) => {
      const optId = `${val}_${idx + 1}`;
      html += `
        <button class="opt-btn" onclick="showRecommendationsDynamic('${optId}')">
          <i data-lucide="check-circle"></i>
          <div class="opt-text">
            <strong>${opt.text}</strong>
          </div>
        </button>
      `;
    });
    step2Opts.innerHTML = html;
    
    document.getElementById("step-1").classList.add("hidden");
    document.getElementById("step-2").classList.remove("hidden");
    lucide.createIcons();
  }
}

async function showRecommendationsDynamic(optId) {
  const simResults = document.getElementById("sim-results");
  simResults.innerHTML = `<p style="color:var(--text-secondary); text-align:center; padding:2rem; width:100%;">추천 솔루션을 조회하고 있습니다...</p>`;
  
  document.getElementById("step-2").classList.add("hidden");
  document.getElementById("step-3").classList.remove("hidden");
  
  try {
    const res = await fetch(`/api/solutions?simulator_mapping=${encodeURIComponent(optId)}`);
    if (!res.ok) throw new Error('추천 결과를 조회할 수 없습니다.');
    const recs = await res.json();
    
    let html = "";
    if (recs.length === 0) {
      html = `<p style="color:var(--text-secondary); text-align:center; padding:2rem; width:100%;">매핑되는 추천 솔루션 가이드가 현재 존재하지 않습니다.</p>`;
    } else {
      // 정합성 정렬 (매우 높음, 높음 순)
      recs.sort((a, b) => {
        const scoreA = a.synergy === '매우 높음' ? 3 : (a.synergy === '높음' ? 2 : 1);
        const scoreB = b.synergy === '매우 높음' ? 3 : (b.synergy === '높음' ? 2 : 1);
        return scoreB - scoreA;
      });

      recs.forEach((isv, idx) => {
        const p_badge = isv.synergy === "매우 높음" || isv.synergy === "높음" ? "추천" : "연계";
        const stars = isv.layer.includes("L0") ? "★" : (isv.synergy === "매우 높음" ? "★★★" : (isv.synergy === "높음" ? "★★" : "★"));
        
        html += `
          <div class="rec-card rec-${idx + 1}" onclick="openModalById(${isv.id})">
            <span class="rec-badge rec-${idx === 0 ? '1' : '2'}">${idx + 1}순위: ${p_badge}</span>
            <div class="rec-title-row">
              <h4>${isv.name}</h4>
              <span class="rec-stars lbl-${stars}">${stars}</span>
            </div>
            <p class="rec-desc">${isv.jtbd}</p>
            <div class="rec-meta">
              <div class="rec-meta-item"><strong>제공 형태:</strong> ${isv.delivery}</div>
              <div class="rec-meta-item"><strong>카테고리:</strong> ${isv.category}</div>
              <div class="rec-meta-item"><strong>시너지:</strong> ${isv.synergy}</div>
            </div>
          </div>
        `;
      });
    }
    
    simResults.innerHTML = html;
  } catch (err) {
    simResults.innerHTML = `<p style="color:#ef4444; text-align:center; padding:2rem; width:100%;">오류: ${err.message}</p>`;
  }
}

function goBack(step) {
  if (step === 2) {
    document.getElementById("step-2").classList.add("hidden");
    document.getElementById("step-1").classList.remove("hidden");
  } else if (step === 3) {
    document.getElementById("step-3").classList.add("hidden");
    document.getElementById("step-2").classList.remove("hidden");
  }
}

function resetSimulator() {
  document.getElementById("step-3").classList.add("hidden");
  document.getElementById("step-2").classList.add("hidden");
  document.getElementById("step-1").classList.remove("hidden");
}

// ----------------------------------------------------
// 2. Matrix Render Logic
// ----------------------------------------------------
function renderMatrixTags() {
  const containers = {
    q1: document.getElementById("matrix-q1-tags"),
    q2: document.getElementById("matrix-q2-tags"),
    q3: document.getElementById("matrix-q3-tags"),
    q4: document.getElementById("matrix-q4-tags"),
    l0: document.getElementById("matrix-l0-tags")
  };
  
  // Clear
  Object.values(containers).forEach(c => c.innerHTML = "");
  
  isvData.forEach(isv => {
    let targetKey = null;
    const l = isv.layer;
    
    // Sort logic to match 4-Layer definitions
    if (l.includes("L0")) {
      targetKey = "l0";
    } else if (l.includes("L1")) {
      targetKey = "q1";
    } else if (l.includes("L2")) {
      targetKey = "q2";
    } else if (l.includes("L3")) {
      targetKey = "q3";
    } else if (l.includes("L4")) {
      targetKey = "q4";
    }
    
    if (targetKey && containers[targetKey]) {
      const stars = isv.layer.includes("L0") ? "★" : (isv.synergy === "매우 높음" ? "★★★" : (isv.synergy === "높음" ? "★★" : "★"));
      
      const tag = document.createElement("button");
      tag.className = `isv-tag tag-${stars}`;
      tag.innerHTML = isv.name;
      tag.onclick = () => openModalById(isv.id);
      containers[targetKey].appendChild(tag);
    }
  });
}

// ----------------------------------------------------
// 3. Explorer Table & Filtering
// ----------------------------------------------------
function renderISVTable(data) {
  const tbody = document.getElementById("isv-table-body");
  tbody.innerHTML = "";
  
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem;">검색 및 필터링 결과가 없습니다.</td></tr>`;
    return;
  }
  
  data.forEach(isv => {
    const stars = isv.layer.includes("L0") ? "★" : (isv.synergy === "매우 높음" ? "★★★" : (isv.synergy === "높음" ? "★★" : "★"));
    
    const row = document.createElement("tr");
    row.onclick = () => openModalById(isv.id);
    
    row.innerHTML = `
      <td><span class="lbl-${stars}">${stars}</span></td>
      <td><strong>${isv.name}</strong></td>
      <td><span class="layer-badge">${isv.layer}</span></td>
      <td>${isv.delivery}</td>
      <td>${isv.synergy}</td>
      <td>${isv.category}</td>
      <td>${isv.jtbd}</td>
      <td style="color: var(--accent-blue); font-weight: 500;">${isv.opinion}</td>
    `;
    
    tbody.appendChild(row);
  });
}

let filterTimeout;
function filterISVs() {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(async () => {
    const searchQuery = document.getElementById("search-input").value.trim();
    const industryFilter = document.getElementById("filter-industry").value;
    const priorityFilter = document.getElementById("filter-priority").value;
    const layerFilter = document.getElementById("filter-layer").value;
    const deliveryFilter = document.getElementById("filter-delivery").value;
    
    try {
      let url = `/api/solutions?1=1`;
      if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
      if (industryFilter !== 'all') url += `&industry=${encodeURIComponent(industryFilter)}`;
      if (layerFilter !== 'all') url += `&layer=${encodeURIComponent(layerFilter)}`;
      if (deliveryFilter !== 'all') url += `&delivery=${encodeURIComponent(deliveryFilter)}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        // Filter by priority locally
        const filtered = data.filter(isv => {
          const stars = isv.layer.includes("L0") ? "★" : (isv.synergy === "매우 높음" ? "★★★" : (isv.synergy === "높음" ? "★★" : "★"));
          return (priorityFilter === "all") || (stars === priorityFilter);
        });
        renderISVTable(filtered);
      }
    } catch (err) {
      console.error('Filtering failed:', err);
    }
  }, 300);
}

// ----------------------------------------------------
// 4. Modal & Custom Markdown Parser
// ----------------------------------------------------
async function openModalById(id) {
  const isvObj = isvData.find(item => item.id === id);
  if (!isvObj) return;
  
  try {
    const res = await fetch(`/api/solutions/${isvObj.slug}`);
    if (!res.ok) throw new Error('상세 정보를 가져올 수 없습니다.');
    const isv = await res.json();
    
    currentSelectedIsv = isv;
    
    // Set headers
    const stars = isv.layer.includes("L0") ? "★" : (isv.synergy === "매우 높음" ? "★★★" : (isv.synergy === "높음" ? "★★" : "★"));
    const priorityBadge = document.getElementById("modal-priority");
    priorityBadge.className = `modal-priority-badge ${stars}`;
    priorityBadge.textContent = `우선순위: ${stars}`;
    
    document.getElementById("modal-title").textContent = isv.name;
    document.getElementById("modal-layer").textContent = isv.layer;
    document.getElementById("modal-delivery").textContent = isv.delivery;
    document.getElementById("modal-synergy").textContent = isv.synergy;
    document.getElementById("modal-value-chain").textContent = isv.value_chain;
    
    // Update opinion under specs
    const modalSpecs = document.querySelector(".modal-specs");
    let opDiv = document.getElementById("modal-opinion-spec");
    if (!opDiv) {
      opDiv = document.createElement("div");
      opDiv.id = "modal-opinion-spec";
      opDiv.className = "spec-item";
      opDiv.style.width = "100%";
      opDiv.style.marginTop = "0.5rem";
      opDiv.style.borderTop = "1px dashed rgba(255,255,255,0.05)";
      opDiv.style.paddingTop = "0.5rem";
      modalSpecs.appendChild(opDiv);
    }
    opDiv.innerHTML = `<span class="label">AI Tech 의견:</span> <span style="color: var(--accent-blue); font-weight: 500;">${isv.opinion}</span>`;
    
    // Reset tabs to 1
    switchTab(null, "1");
    
    toggleModal(true);
  } catch (err) {
    alert('솔루션 상세 정보를 불러오는 데 실패했습니다: ' + err.message);
  }
}

function toggleModal(show) {
  const modal = document.getElementById("detail-modal");
  if (show) {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden"; // disable scroll
  } else {
    modal.classList.add("hidden");
    document.body.style.overflow = ""; // enable scroll
  }
}

function closeModal(event) {
  toggleModal(false);
}

function switchTab(event, tabId) {
  currentActiveTab = tabId;
  
  // UI classes update
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(btn => btn.classList.remove("active"));
  
  if (event) {
    event.target.classList.add("active");
  } else {
    // manual fallback (defaults to tab 1)
    const firstTabBtn = document.querySelector(`.tab-btn[onclick*="'${tabId}'"]`);
    if (firstTabBtn) firstTabBtn.classList.add("active");
  }
  
  renderTabContent();
}

const overallChecklist = [
  "회사의 정보보호 가이드라인 및 데이터 반출 규제(개인정보 가명화 요건 등)를 만족하는가?",
  "사내 통합 ID 관리체계(SSO/SCIM/Okta 등)와 연동이 가능한가?",
  "도입 후 비용 모니터링(FinOps) 및 예산 초과 시 자동 제어(가드레일 프록시 등) 정책이 수립되었는가?",
  "AI 도입 목적이 전사 생산성 향상(Q1), 도메인 자동화(Q2), 개발 환경(Q3), 인프라 제어(Q4) 중 어디에 해당하는지 명확히 정의하였는가?",
  "클라우드/온프레미스 인프라 아키텍처 및 GPU 서버(H100 등) 선행 예산이 확보되었는가?"
];

function downloadChecklist(isvName, overallItems, isvItemsRaw) {
  let txt = `=========================================\n`;
  txt += ` MZC AI Platform - [${isvName}] 도입 체크리스트\n`;
  txt += `=========================================\n\n`;
  txt += `[1] 오버롤 공통 체크리스트 (MZC 필수 요건)\n`;
  overallItems.forEach((item, idx) => {
    txt += `  [ ] ${idx + 1}. ${item}\n`;
  });
  txt += `\n[2] ${isvName} 전용 체크리스트\n`;
  const lines = isvItemsRaw.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  lines.forEach((line) => {
    const cleanLine = line.replace(/^-\s*/, "").replace(/^\[\s*\]\s*/, "").replace(/\*\*/g, "");
    txt += `  [ ] ${cleanLine}\n`;
  });
  txt += `\n-----------------------------------------\n`;
  txt += `* 본 체크리스트는 AI 제안 내용을 포함하고 있으므로 실무 적용 시 PreSales 기술 검증이 필수입니다.\n`;
  txt += `© 2026 MegazoneCloud AI GTM & PreSales Team.`;
  
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MZC_AI_Checklist_${isvName.replace(/\s+/g, '_')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderTabContent() {
  if (!currentSelectedIsv) return;
  
  const contentContainer = document.getElementById("tab-content");
  const markdownText = currentSelectedIsv.sections[currentActiveTab] || "상세 정보가 존재하지 않습니다.";
  
  if (currentActiveTab === "7") {
    // Render Checklist tab with split layout and download button
    let html = `
      <div class="checklist-tab-layout" style="display: flex; flex-direction: column; gap: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
          <h3 style="margin: 0; color: var(--accent-blue);">도입 검토 체크리스트</h3>
          <div style="display: flex; gap: 10px;">
            <button class="download-btn" onclick="downloadChecklist('${currentSelectedIsv.name}', overallChecklist, \`${markdownText.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" style="display: flex; align-items: center; gap: 6px; background: var(--accent-blue); color: white; border: none; padding: 8px 14px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.85rem; transition: background 0.2s;">
              <i data-lucide="download" style="width: 14px; height: 14px;"></i>
              체크리스트 (.txt)
            </button>
            <a href="./[공통] AI도입_요구사항_질의서.docx" download="[공통] AI도입_요구사항_질의서.docx" class="download-btn" style="display: inline-flex; align-items: center; gap: 6px; background: var(--accent-purple); color: white; border: none; padding: 8px 14px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.85rem; transition: background 0.2s; text-decoration: none;">
              <i data-lucide="file-text" style="width: 14px; height: 14px;"></i>
              공통 질의서 (.docx)
            </a>
          </div>
        </div>
        <div class="checklist-grid" style="display: grid; grid-template-columns: 1fr; gap: 20px;">
          <div class="overall-checklist-box" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 16px; border-radius: 8px;">
            <h4 style="margin-top: 0; color: #ffc107; display: flex; align-items: center; gap: 6px; font-size: 0.95rem;">
              <i data-lucide="shield-check" style="width: 16px; height: 16px;"></i>
              [1] 오버롤 공통 체크리스트 (MZC 기술 보증 공통 기준)
            </h4>
            <ul style="margin-bottom: 0;">
    `;
    
    overallChecklist.forEach(item => {
      html += `<li>${item}</li>`;
    });
    
    html += `
            </ul>
          </div>
          <div class="isv-checklist-box" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 16px; border-radius: 8px;">
            <h4 style="margin-top: 0; color: var(--accent-blue); display: flex; align-items: center; gap: 6px; font-size: 0.95rem;">
              <i data-lucide="check-square" style="width: 16px; height: 16px;"></i>
              [2] ${currentSelectedIsv.name} 전용 체크리스트
            </h4>
            ${parseMarkdownToHTML(markdownText)}
          </div>
        </div>
      </div>
    `;
    contentContainer.innerHTML = html;
    lucide.createIcons();
  } else if (currentActiveTab === "8") {
    let html = `
      <div class="warning-box" style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-left: 4px solid #ef4444; padding: 12px; margin-bottom: 16px; border-radius: 4px; color: #f87171; font-weight: 500; font-size: 0.875rem; display: flex; align-items: center; gap: 8px;">
        <i data-lucide="alert-triangle" style="width: 16px; height: 16px; flex-shrink: 0; color: #ef4444;"></i>
        <span>AI가 조사/제안한 내용이므로 일부 정확하지 않은 정보가 포함되어 있을 수 있습니다. (PreSales 실무 검토 필수)</span>
      </div>
      ${parseMarkdownToHTML(markdownText)}
    `;
    contentContainer.innerHTML = html;
    lucide.createIcons();
  } else {
    contentContainer.innerHTML = parseMarkdownToHTML(markdownText);
    lucide.createIcons();
  }
}

// Custom Markdown to HTML Helper
function parseMarkdownToHTML(md) {
  if (!md) return "";
  
  const lines = md.split("\n");
  let html = [];
  let listStack = [];
  
  function closeLists(targetDepth) {
    while (listStack.length > targetDepth) {
      html.push(`</${listStack.pop()}>`);
    }
  }
  
  for (let line of lines) {
    let trimmed = line.trim();
    
    // Check for update pending tag
    if (trimmed === "- 업데이트 예정") {
      closeLists(0);
      html.push(`<div class="update-pending-box" style="background: rgba(255, 193, 7, 0.05); border: 1px solid rgba(255, 193, 7, 0.2); border-left: 4px solid #ffc107; padding: 12px; margin: 12px 0; border-radius: 4px; color: #ffc107; font-weight: 500; font-size: 0.875rem; display: flex; align-items: center; gap: 8px;">
        <i data-lucide="alert-circle" style="width: 16px; height: 16px; flex-shrink: 0;"></i>
        <span>상세 솔루션 간 시너지 및 아키텍처 정합성 정보는 PreSales 실무 검증 후 업데이트 예정입니다.</span>
      </div>`);
      continue;
    }
    
    // Header 3/4
    if (trimmed.startsWith("###")) {
      closeLists(0);
      html.push(`<h3>${trimmed.replace(/###/g, "").trim()}</h3>`);
      continue;
    }
    
    if (trimmed.startsWith("####")) {
      closeLists(0);
      html.push(`<h4>${trimmed.replace(/####/g, "").trim()}</h4>`);
      continue;
    }
    
    // Bullet lists (- or *)
    if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
      let matchIndent = line.match(/^(\s*)/);
      let indentSpaces = matchIndent ? matchIndent[1].length : 0;
      let depth = indentSpaces >= 2 ? 1 : 0;
      
      if (listStack.length <= depth) {
        while (listStack.length <= depth) {
          html.push("<ul style='margin-bottom: 0.5rem;'>");
          listStack.push("ul");
        }
      } else if (listStack.length > depth + 1) {
        closeLists(depth + 1);
      }
      
      let cleanLi = trimmed.substring(1).trim();
      cleanLi = parseBoldText(cleanLi);
      html.push(`<li>${cleanLi}</li>`);
      continue;
    }
    
    // Plain line - keep list open, skip empty paragraphs
    if (trimmed === "") {
      continue;
    }
    
    // Default text line
    closeLists(0);
    html.push(`<p>${parseBoldText(trimmed)}</p>`);
  }
  
  closeLists(0);
  return html.join("\n");
}

function parseBoldText(text) {
  // Replace **text** with <strong>text</strong>
  return text.replace(/\*\*(.*?)\*\"/g, "<strong>$1</strong>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function exportSolutionWord() {
  if (!currentSelectedIsv) return;
  const cleanName = currentSelectedIsv.name.replace(/ /g, "_").replace(/\./g, "");
  const docxFilename = `MZC_AI_솔루션_가이드_${cleanName}.docx`;
  
  const a = document.createElement("a");
  a.href = `./docs/${docxFilename}`;
  a.download = docxFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
