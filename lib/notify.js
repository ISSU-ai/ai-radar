'use strict';

/**
 * 고객에게 나가는 알림.
 *
 * 지금까지 이 시스템은 **고객에게 우리가 먼저 보내는 수단이 없었다.** 접수하면
 * Slack 이 영업에게만 가고, 42문항을 다 답하고 연락처까지 남긴 가장 뜨거운 순간에
 * 고객 쪽으로 아무것도 안 갔다.
 *
 * 발송 수단은 아직 정하지 않았다(사용자 결정 2026-08-13). 그래서 **지점만** 만든다 —
 * 무엇을 언제 보낼지는 여기서 굳고, 어떻게 보낼지는 나중에 한 함수만 채우면 된다.
 *
 * 규약은 routes/hub.js 의 slackNotify 를 그대로 따른다.
 *   · env 가 없으면 조용히 no-op. 메일이 안 나가도 **접수는 성공해야 한다** —
 *     고객은 이미 폼을 냈고, 우리 발송 실패를 고객 화면에서 볼 이유가 없다.
 *   · 예외를 삼키고 로그만 남긴다.
 *   · 부르는 쪽은 `void` 로 부른다. 응답을 막지 않는다.
 *
 * 순수하게 유지한다 — DB 도 pool 도 모른다. 부르는 쪽이 데이터를 다 넘긴다.
 */

/** 발송이 켜져 있나. 수단이 붙기 전까지는 늘 false 다. */
const mailEnabled = () => Boolean(process.env.MAIL_PROVIDER_URL && process.env.MAIL_FROM);

/**
 * 실제 전송. 수단이 정해지면 여기만 채운다.
 *
 * HTTP API 형(Resend·Postmark 등)이면 Node 내장 fetch 로 충분해 **새 의존성이 0** 이다.
 * SMTP 를 쓰기로 하면 nodemailer 가 필요하고, 그때도 이 함수의 겉모습은 안 바뀐다.
 */
async function sendMail({ to, subject, html, text }) {
  if (!mailEnabled()) {
    // 수단이 없을 때도 무엇이 나갈 뻔했는지는 남긴다. 로컬·스테이징에서 이걸 보고
    // 본문을 확인한다. 주소는 개인정보라 도메인만 남긴다.
    console.log('[mail:skipped]', JSON.stringify({
      to: String(to || '').replace(/^[^@]+/, '***'), subject, length: (text || html || '').length
    }));
    return { sent: false, reason: 'disabled' };
  }
  try {
    const response = await fetch(process.env.MAIL_PROVIDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.MAIL_API_KEY ? { Authorization: `Bearer ${process.env.MAIL_API_KEY}` } : {})
      },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject, html, text })
    });
    if (!response.ok) {
      console.error(`Mail send failed: ${response.status}`);
      return { sent: false, reason: `http_${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    console.error('Mail send failed:', error.message);
    return { sent: false, reason: 'error' };
  }
}

/** 링크는 절대 주소여야 한다 — 메일 안에서 상대 경로는 열리지 않는다. */
const absolute = (path) => {
  if (!path) return '';
  const base = String(process.env.PUBLIC_BASE_URL || 'https://ai-radar-7pg2.onrender.com').replace(/\/+$/, '');
  return `${base}${path}`;
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

/**
 * 접수 직후 고객에게 가는 1통.
 *
 * **리포트를 메일에 다 넣지 않는다.** 요약 다섯 줄과 우선 개선 영역의 처방까지만
 * 담고 전체는 링크로 보낸다 — 긴 메일은 안 읽히고, 링크는 열람 여부를 알 수 있다.
 *
 * PDF 를 첨부하지 않는 이유: 서버에서 한글 PDF 를 만들려면 CJK 폰트를 저장소에
 * 넣어야 한다(report.js 머리말 참고). 결과 화면에 PDF 저장 버튼이 이미 있다.
 */
function buildLeadReceipt({ customer, readiness, resultUrl }) {
  const priorities = Array.isArray(readiness?.priorities) ? readiness.priorities.slice(0, 3) : [];
  const maturity = readiness?.maturity;
  const average = Number(readiness?.average);

  const lines = priorities.map((p, index) => {
    // 축마다 처방 하나만. 세 축 × 세 문항을 다 넣으면 메일이 리포트가 된다.
    const fix = (p.items || []).map((item) => item.fix).find(Boolean) || '';
    return `${index + 1}. ${p.name} (${Number(p.score).toFixed(2)} / 5)${fix ? `\n   → ${fix}` : ''}`;
  });

  const text = [
    `${customer} 님의 AI 준비도 진단 결과입니다.`,
    '',
    Number.isFinite(average)
      ? `종합 ${average.toFixed(2)} / 5.00${maturity ? ` · Level ${maturity.level} ${maturity.name}` : ''}`
      : '진단 결과를 계산하지 못했습니다.',
    maturity?.note ? maturity.note : '',
    '',
    lines.length ? '우선 개선 영역' : '',
    ...lines,
    '',
    resultUrl ? `전체 결과 보기 — ${resultUrl}` : '',
    resultUrl ? '이 링크에서 PDF·Word 로 내려받을 수 있습니다. 1년간 유효합니다.' : '',
    '',
    '담당자가 확인한 뒤 연락드리겠습니다.',
    '',
    '이 결과는 자가 진단 기반의 참고용입니다.',
    '실제 실행 범위는 데이터·보안·업무 환경을 함께 검토해 확정합니다.'
  ].filter((line) => line !== null).join('\n');

  const html = `<div style="font-family:Pretendard,'맑은 고딕',sans-serif;font-size:14px;line-height:1.75;color:#182331;max-width:560px">
  <p><b>${escapeHtml(customer)}</b> 님의 AI 준비도 진단 결과입니다.</p>
  <p style="padding:14px 16px;background:#f5f8fc;border-radius:10px;margin:18px 0">
    종합 <b style="font-size:20px">${Number.isFinite(average) ? average.toFixed(2) : '—'}</b> / 5.00
    ${maturity ? `· Level ${maturity.level} ${escapeHtml(maturity.name)}` : ''}
    ${maturity?.note ? `<br><span style="color:#66748a;font-size:13px">${escapeHtml(maturity.note)}</span>` : ''}
  </p>
  ${lines.length ? `<p style="margin-bottom:6px"><b>우선 개선 영역</b></p>
  <ol style="padding-left:18px;margin-top:0">${priorities.map((p) => {
    const fix = (p.items || []).map((item) => item.fix).find(Boolean) || '';
    return `<li style="margin-bottom:10px">${escapeHtml(p.name)}
      <span style="color:#8b98a9">(${Number(p.score).toFixed(2)} / 5)</span>
      ${fix ? `<br><span style="color:#2367e8;font-weight:600">${escapeHtml(fix)}</span>` : ''}</li>`;
  }).join('')}</ol>` : ''}
  ${resultUrl ? `<p style="margin:22px 0">
    <a href="${escapeHtml(resultUrl)}" style="display:inline-block;padding:11px 20px;background:#2367e8;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">전체 결과 보기</a>
    <br><span style="color:#8b98a9;font-size:12px">PDF·Word 로 내려받을 수 있습니다. 1년간 유효합니다.</span>
  </p>` : ''}
  <p>담당자가 확인한 뒤 연락드리겠습니다.</p>
  <p style="color:#8b98a9;font-size:12px;border-top:1px solid #e6ebf2;padding-top:12px;margin-top:22px">
    이 결과는 자가 진단 기반의 참고용입니다.<br>실제 실행 범위는 데이터·보안·업무 환경을 함께 검토해 확정합니다.</p>
</div>`;

  return { subject: `${customer} — AI 준비도 진단 결과`, text, html };
}

/** 접수 트랜잭션이 커밋된 뒤 부른다. 실패해도 접수는 이미 끝나 있다. */
async function sendLeadReceipt({ lead, readiness, resultPath }) {
  if (!lead?.contact) return { sent: false, reason: 'no_contact' };
  const { subject, text, html } = buildLeadReceipt({
    customer: lead.customer,
    readiness,
    resultUrl: absolute(resultPath)
  });
  return sendMail({ to: lead.contact, subject, html, text });
}

module.exports = { mailEnabled, sendMail, buildLeadReceipt, sendLeadReceipt, absolute };
