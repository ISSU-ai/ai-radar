# -*- coding: utf-8 -*-
"""admin.html 의 폼 편집기 항목을 엑셀 표로 뽑는다.
라벨·입력형태·선택지는 HTML 에서 직접 읽는다. 손으로 옮겨 적으면 화면이 바뀌었을 때
표만 옛말을 하게 된다. 쓰임·게이트는 코드에서 확인한 내용을 붙인다."""
import re, sys, zipfile, html as H

ROOT = '/Users/mz01-wonzero/CC/ai-radar'
src = open(f'{ROOT}/admin.html', encoding='utf-8').read()
i = src.index('<div id="tab-admin-form"')
nxt = [m.start() for m in re.finditer(r'<div id="tab-admin-\w+"', src) if m.start() > i]
body = src[i:nxt[0]]

def clean(t):
    t = re.sub(r'<[^>]+>', '', t)
    return H.unescape(re.sub(r'\s+', ' ', t)).strip()

# ── HTML 에서 라벨·입력형태·선택지를 읽는다 ─────────────────────────
labels, options = {}, {}
for m in re.finditer(r'<label[^>]*class="control-label"[^>]*for="([\w-]+)"[^>]*>(.*?)</label>', body, re.S):
    labels[m.group(1)] = clean(m.group(2))
# for= 없이 감싸는 라벨(체크박스)은 안쪽 input id 로 잇는다.
for m in re.finditer(r'<label[^>]*>(.*?)</label>', body, re.S):
    inner = re.search(r'id="([\w-]+)"', m.group(1))
    if inner and inner.group(1) not in labels:
        labels[inner.group(1)] = clean(re.sub(r'<input[^>]*>', '', m.group(1)))
for m in re.finditer(r'<select[^>]*id="([\w-]+)"[^>]*>(.*?)</select>', body, re.S):
    opts = [clean(o) or '(빈 값)' for o in re.findall(r'<option[^>]*>(.*?)</option>', m.group(2), re.S)]
    options[m.group(1)] = ' / '.join(opts)
kinds, hints = {}, {}
for m in re.finditer(r'<(input|select|textarea)[^>]*id="([\w-]+)"[^>]*?>', body, re.S):
    tag, fid = m.group(1), m.group(2)
    raw = m.group(0)
    t = (re.search(r'type="(\w+)"', raw) or [None, 'text'])[1] if tag == 'input' else tag
    kinds[fid] = {'text': '한 줄 입력', 'number': '숫자 입력', 'checkbox': '체크박스',
                  'hidden': '(숨김)', 'select': '드롭다운', 'textarea': '여러 줄 입력'}.get(t, t)
    ph = re.search(r'placeholder=[\'"](.*?)[\'"]', raw, re.S)
    if ph: hints[fid] = H.unescape(re.sub(r'\s+', ' ', ph.group(1))).strip()
for m in re.finditer(r'<small[^>]*>(.*?)</small>', body, re.S):
    pass
industries = [H.unescape(x) for x in re.findall(r'name="sol-industries" value="([^"]+)"', body)]

# ── 코드에서 확인한 메타 (저장 컬럼 · 쓰임 · 필수) ─────────────────
# 저장 컬럼은 admin.html 의 buildPayload() 에서, 게이트는 lib/solution-completeness.js 에서 왔다.
G1, G2, G3, G4, G5, G6, G7 = ('1. 기본 정보', '2. 등급·담당·운영', '3. 가격 (딜 시뮬레이터)',
                              '4. 메모', '5. 분류', '6. 상세 본문 (카탈로그 8탭)', '7. 추천 판정 데이터')
META = {
 'sol-name':      (G1, 'name', '필수', '공개', '카탈로그·허브·피치 전반의 표시 이름'),
 'sol-layer':     (G1, 'layer', '', '공개', '4-Layer 분류. 슬롯과 층이 어긋나면 발행이 막힌다'),
 'sol-delivery':  (G1, 'delivery', '', '공개', '카탈로그 표시'),
 'sol-synergy':   (G1, 'synergy', '', '공개', '추천 정렬 가중치'),
 'sol-category':  (G1, 'category', '', '공개', '카탈로그 표시·검색'),
 'sol-value-chain':(G1, 'value_chain', '', '공개', '카탈로그 표시'),
 'sol-jtbd':      (G1, 'jtbd', '', '공개', '세일즈 피치 §3 「왜 이 고객에」 기본값'),
 'sol-grade':     (G2, 'grade', '', '공개', '추천 정렬'),
 'sol-scale':     (G2, 'scale', '', '공개', '딜 규모 산정'),
 'sol-focal':     (G2, 'focal_id', '', '사내', '포컬 배정. 허브 STEP03 에 표시'),
 'sol-status-op': (G2, 'status_op', '', '사내', '운영 상태'),
 'sol-price-type':(G3, 'price_type', '', '사내', '딜 사이즈 시뮬레이터. 미설정이면 견적에서 빠진다'),
 'sol-unit-price':(G3, 'unit_price', '', '사내', '시뮬레이터 단가'),
 'sol-currency':  (G3, 'currency', '', '사내', 'USD 는 전역 환율로 환산'),
 'sol-price-tiers':(G3, 'price_tiers', '', '사내', 'seat 전용 볼륨 구간. 있으면 단가 대신 쓴다'),
 'sol-price-confirmed':(G3, 'price_is_placeholder', '', '사내', '끄면 「별도협의」로 표시되고 합계에서 빠진다'),
 'sol-tech-note': (G4, 'tech_note', '', '사내', '허브 STEP03 경고'),
 'sol-note':      (G4, 'note', '', '사내', '벤더 협의 이력'),
 'sol-opinion':   (G4, 'opinion', '', '내부 전용 🔒', 'viewer 에게 마스킹. 전략·마진 코멘트'),
 'sol-slot':      (G7, 'slot', '필수', '사내', '같은 슬롯끼리만 순위 비교. 없으면 추천 후보가 안 된다'),
 'sol-bundle-potential':(G7, 'bundle_potential', '', '사내', '적합 후보 사이의 정렬'),
 'sol-prerequisites':(G7, 'assessment_prerequisites', '', '사내', '요구 조건. manual 은 STEP03 체크박스로 넘어간다'),
 'sol-red-flags': (G7, 'red_flags', '', '사내', '제외 사유와 대안. 대안 없으면 발행이 막힌다'),
}
SECTIONS = [
 ('1', '솔루션 개요 / 핵심 차별점', '카탈로그 §1 · **세일즈 피치 부록의 「강점」 3줄이 여기서 나온다**'),
 ('2', '4-Layer 포지셔닝 매핑', '카탈로그 §2'),
 ('3', '적합 고객 / 산업군 / 페르소나', '카탈로그 §3 · 「○ 매우 적합」 산업 표시가 없으면 경고'),
 ('4', '솔루션 기반 레퍼런스 아키텍처', '카탈로그 §4'),
 ('5', '유즈케이스 및 도입 시나리오', '카탈로그 §5'),
 ('6', '경쟁 솔루션 비교 매트릭스', '카탈로그 §6'),
 ('7', '도입 검토 체크리스트', '카탈로그 §7'),
 ('8', '영업 Tip / FAQ', '카탈로그 §8 · **피치 부록의 「화법」 2줄이 §8.1 에서 나온다**'),
]

rows = []
def add(group, name, kind, choice, req, scope, col, use, note=''):
    rows.append([str(len(rows) + 1), group, name, kind, choice, req, scope, col, use, note, ''])

ORDER = ['sol-name','sol-layer','sol-delivery','sol-synergy','sol-category','sol-value-chain','sol-jtbd',
         'sol-grade','sol-scale','sol-focal','sol-status-op',
         'sol-price-type','sol-unit-price','sol-currency','sol-price-tiers','sol-price-confirmed',
         'sol-tech-note','sol-note','sol-opinion']
for fid in ORDER:
    g, col, req, scope, use = META[fid]
    add(g, labels.get(fid, fid), kinds.get(fid, ''), options.get(fid, hints.get(fid, '')), req, scope, col, use)

add(G5, '적합 업종 (Domain) 분류', '체크박스 (복수)', ' / '.join(industries), '', '공개', 'industries', '업종 필터·추천 적합도')
add(G5, '시뮬레이터 의사결정 트리 매핑', '체크박스 (복수)', '화면에서 동적으로 채워진다', '', '사내', 'simulator_mappings', '레이더 시뮬레이터 분기')

for key, title, use in SECTIONS:
    add(G6, f'{key}. {title}', '여러 줄 입력', '마크다운 평문', '', '공개', f"sections['{key}']", use)
    if key in ('1', '8'):
        add(G6, f'└ {key}번 관리자 전용 내부 코멘트', '여러 줄 입력', '마크다운 평문', '', '내부 전용 🔒',
            f"sections_internal['{key}']", 'viewer 미노출. §8 은 마진·딜사이즈 전략')

g, col, req, scope, use = META['sol-slot']; add(g, labels.get('sol-slot','역할 슬롯'), '드롭다운', '슬롯 분류표에서 선택', req, scope, col, use)
g, col, req, scope, use = META['sol-bundle-potential']; add(g, labels.get('sol-bundle-potential',''), '드롭다운', options.get('sol-bundle-potential',''), req, scope, col, use)
add(G7, '메우는 준비도 갭 (화면 표기: FQA Coverage)', '체크박스 + 강도', '10개 평가영역(A01~A10) × 강도 0~3', '필수', '사내',
    'assessment_coverage', '이 솔루션이 해결해 주는 영역. 없으면 발행이 막힌다',
    '⚠ 화면 라벨이 옛 어휘(FQA)로 남아 있다. 저장은 assessment_coverage 로 간다')
for fid in ('sol-prerequisites', 'sol-red-flags'):
    g, col, req, scope, use = META[fid]
    add(g, labels.get(fid, fid), '여러 줄 입력 (JSON)', hints.get(fid, 'JSON 배열'), req, scope, col, use)

GATES = [
 ['차단', '역할 슬롯 미지정', '슬롯이 없으면 추천 후보가 되지 않는다', 'sol-slot'],
 ['차단', '슬롯이 분류표에 없음', '이름이 한 글자만 달라도 매칭 0건이 된다', 'sol-slot'],
 ['차단', '슬롯과 4-Layer 불일치', '층이 어긋나면 추천 근거가 무너진다', 'sol-layer'],
 ['차단', '메우는 준비도 갭 없음', '무엇을 해결하는지 모르면 추천할 수 없다', 'assessment_coverage'],
 ['차단', '본문에 자리표시자 잔존', '{변수}, TODO/TBD, Lorem ipsum, "여기에 입력", ____', '상세 본문 1~8'],
 ['차단', '다른 솔루션과 본문 중복', '베껴 온 문단이 남으면 고객 앞에서 들킨다', '상세 본문 1~8'],
 ['차단', '부적합 신호에 signal 없음', 'JSON 형식 오류', 'sol-red-flags'],
 ['차단', '부적합 신호에 대안 없음', '제외만 하고 대안이 없으면 영업이 쓸 수 없다', 'sol-red-flags'],
 ['차단', '대안 슬러그가 카탈로그에 없음', '끊어진 링크', 'sol-red-flags'],
 ['경고', '전제 조건 비어 있음', '', 'sol-prerequisites'],
 ['경고', '부적합 신호 비어 있음', '', 'sol-red-flags'],
 ['경고', '§3 에 「○ 매우 적합」 산업 없음', '', '상세 본문 3'],
 ['경고', '본문이 권장 길이 미만', '', '상세 본문 1~8'],
 ['경고', '번들 확장성 미지정', '정렬에서 불리해진다', 'sol-bundle-potential'],
]

# ── xlsx 로 쓴다 (외부 라이브러리 없이) ────────────────────────────
def esc(v): return H.escape(str(v), quote=False)
def sheet_xml(headers, data, widths):
    def row(cells, i, style=''):
        out = []
        for c, v in enumerate(cells):
            ref = f'{chr(65 + c) if c < 26 else "A" + chr(65 + c - 26)}{i}'
            out.append(f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{esc(v)}</t></is></c>')
        return f'<row r="{i}">' + ''.join(out) + '</row>'
    cols = ''.join(f'<col min="{n+1}" max="{n+1}" width="{w}" customWidth="1"/>' for n, w in enumerate(widths))
    rs = [row(headers, 1, ' s="1"')] + [row(r, n) for n, r in enumerate(data, 2)]
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      f'<sheetPr><outlinePr/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      f'<cols>{cols}</cols><sheetData>' + ''.join(rs) + '</sheetData>'
      f'<autoFilter ref="A1:{chr(64+len(headers))}{len(data)+1}"/></worksheet>')

H1 = ['순번','구분','항목명 (화면 표기)','입력 형태','선택지 / 형식','필수','공개 범위','저장 컬럼','어디에 쓰이는가','비고','검토 의견 (유지/제거/추가)']
W1 = [6, 22, 40, 16, 46, 7, 13, 26, 52, 46, 30]
H2 = ['구분','게이트','왜 막는가','관련 항목','검토 의견']
W2 = [8, 32, 46, 22, 30]

styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
 '<fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/></font>'
 '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts>'
 '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
 '<fill><patternFill patternType="solid"><fgColor rgb="FF16233A"/><bgColor indexed="64"/></patternFill></fill></fills>'
 '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
 '<cellXfs count="2"><xf xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
 '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
 '</cellXfs></styleSheet>')

out = f'{ROOT}/docs/admin-form-fields.xlsx'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
    z.writestr('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    z.writestr('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      '<sheet name="폼 편집기 항목" sheetId="1" r:id="rId1"/>'
      '<sheet name="발행 게이트" sheetId="2" r:id="rId2"/></sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    z.writestr('xl/styles.xml', styles)
    z.writestr('xl/worksheets/sheet1.xml', sheet_xml(H1, rows, W1))
    z.writestr('xl/worksheets/sheet2.xml', sheet_xml(H2, [g + [''] for g in GATES], W2))

print(f'{out}\n항목 {len(rows)}개 · 게이트 {len(GATES)}개')
for r in rows: print(' ', r[1], '|', r[2][:44], '|', r[7])
