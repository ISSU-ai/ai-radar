'use strict';

/**
 * 고객 분류 어휘. 화면 여러 곳이 같은 필드를 쓰므로 목록은 한 군데에만 둔다.
 *
 * 왜 파일을 따로 팠나: 상담 폼(/offering)과 허브 인테이크(/hub)가 둘 다
 * `customer_meta.companySize` 를 쓰는데 선택지를 각자 하드코딩하고 있었다. 그래서
 * 같은 필드에 "100~499명"(허브) 과 "200~500명"(상담 폼) 이 섞여 들어갔다.
 * 그렇게 되면 규모로 묶어 보는 일이 전부 어긋난다 — 업종을 자유입력에서 셀렉트로
 * 바꾼 이유와 똑같은 문제를 규모에서 반복한 셈이었다.
 *
 * 값의 출처는 진단기준 엑셀(OpenAI_AI_Offering_Diagnostic_20Q.xlsx)의
 * 「고객 기본정보」 시트다. 오퍼링 문서가 기준이므로 그쪽에 맞춘다.
 */
(function (global) {
  /** 「고객 기본정보」 시트의 직원 수 구간. 저장값이자 표시값이다. */
  const COMPANY_SIZES = Object.freeze([
    '200명 미만',
    '200~500명',
    '501~1,000명',
    '1,000명 초과'
  ]);

  /** 연 매출 구간. 같은 시트. 아직 폼에는 없고 허브에서 쓴다. */
  const REVENUE_BANDS = Object.freeze([
    '10억 미만',
    '10억~100억 미만',
    '100억~1,000억 미만',
    '1,000억 이상'
  ]);

  /**
   * 업종. 「SFDC산업」 시트의 분류를 그대로 쓴다.
   * 자유입력이면 "금융"·"금융업"·"은행" 이 다 다른 값이 되어 업종별 비교를 못 한다.
   * SFDC 코드를 저장하면 CRM 과도 값이 맞는다.
   */
  const INDUSTRIES = Object.freeze([
    ['Agriculture', '농업'], ['Apparel', '의류'], ['Banking', '은행'],
    ['Biotechnology', '생명공학'], ['Chemicals', '화학'], ['Communications', '커뮤니케이션'],
    ['Construction', '건설'], ['Consulting', '컨설팅'], ['Education', '교육'],
    ['Electronics', '전자'], ['Energy', '에너지'], ['Engineering', '기술'],
    ['Entertainment', '엔터테인먼트'], ['Environmental', '환경'], ['Finance', '금융'],
    ['Food & Beverage', '식음료'], ['Government', '정부'], ['Healthcare', '건강'],
    ['Hospitality', '숙박'], ['Insurance', '보험'], ['Machinery', '기계'],
    ['Manufacturing', '제조'], ['Media', '미디어'], ['Not for Profit', '비영리'],
    ['Recreation', '레크레이션'], ['Retail', '유통'], ['Shipping', '선박'],
    ['Technology', 'IT'], ['Telecommunications', '통신'], ['Transportation', '교통'],
    ['Utilities', '인프라'], ['Other', '기타']
  ]);

  /** SFDC 코드 → 한글 라벨. 저장된 코드를 화면에 풀어 쓸 때 쓴다. */
  const industryLabel = (code) => {
    const hit = INDUSTRIES.find(([value]) => value === code);
    return hit ? `${hit[1]} (${hit[0]})` : (code || '');
  };

  /**
   * 028 이전에 저장된 허브 어휘를 새 구간으로 읽는다.
   * DB 는 028 이 한 번에 바꾸지만, 그 전에 저장된 값을 화면이 만나면 셀렉트에서
   * 아무것도 선택되지 않은 것처럼 보이고 그대로 저장하면 값이 날아간다.
   *
   * ⚠ 경계가 딱 맞지 않는다. 100~499 는 200 을 걸치고, 500~1,999 는 1,000 을 걸친다.
   *   중앙값 기준으로 옮기되 500~1,999 는 아래쪽(501~1,000)으로 보수적으로 잡는다.
   */
  const LEGACY_SIZES = Object.freeze({
    '1~99명': '200명 미만',
    '100~499명': '200~500명',
    '500~1,999명': '501~1,000명',
    '2,000명 이상': '1,000명 초과'
  });

  const normaliseCompanySize = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (COMPANY_SIZES.includes(text)) return text;
    return LEGACY_SIZES[text] || text;
  };

  global.IssuTaxonomy = {
    COMPANY_SIZES, REVENUE_BANDS, INDUSTRIES, LEGACY_SIZES,
    industryLabel, normaliseCompanySize
  };
})(typeof window === 'undefined' ? globalThis : window);
