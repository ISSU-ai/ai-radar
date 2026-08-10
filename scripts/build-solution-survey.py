# -*- coding: utf-8 -*-
"""솔루션 조사용 엑셀 서식을 만든다 (빈 양식 배포용).

행이 솔루션, 열이 항목인 가로형이다. 항목·선택지는 admin.html 과 마이그레이션에서
**직접 읽는다.** 손으로 옮겨 적으면 화면이 바뀌었을 때 서식만 옛말을 한다.

  python3 scripts/build-solution-survey.py            # 빈 양식
  python3 scripts/build-solution-survey.py --rows 30  # 입력 행 수

⚠ 이건 **조사 수집용**이고 시스템에 자동으로 들어가지 않는다. 채워서 모으면
  ISSU 가 /admin 폼에 옮겨 적는다(사용자 결정). JSON 을 조사자에게 쓰게 하지
  않는 이유도 그것 — 사람이 읽고 옮길 것이므로 평문이 낫다.
"""
import argparse
import html as H
import re
import zipfile

ROOT = '/Users/mz01-wonzero/CC/ai-radar/'
read = lambda f: open(ROOT + f, encoding='utf-8').read()
clean = lambda t: H.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', t))).strip()

# ── 원본에서 읽는다 ───────────────────────────────────────────────
admin = read('admin.html')
_form = admin[admin.index('<div id="tab-admin-form"'):]
_form = _form[:re.search(r'<div id="tab-admin-(?!form)\w+"', _form).start()]

def options(select_id):
    m = re.search(rf'<select[^>]*id="{select_id}"[^>]*>(.*?)</select>', _form, re.S)
    return [clean(o) for o in re.findall(r'<option[^>]*>(.*?)</option>', m.group(1), re.S) if clean(o)]

INDUSTRIES = [H.unescape(x) for x in re.findall(r'name="sol-industries" value="([^"]+)"', _form)]

# 슬롯 분류표 — 011
_slot_sql = read('db/migrations/011_slot_taxonomy_and_layer_fixes.sql')
SLOTS = [(m[0], m[1], m[2]) for m in re.findall(
    r"\('([\w-]+)',\s*'([^']+)',\s*'(L\d)'", _slot_sql)]

# 평가영역 — 036
_area_sql = read('db/migrations/036_assessment_criteria.sql')
AREAS = [(m[0], m[1], m[2]) for m in re.findall(
    r"\('(A\d\d)',\s*'D\d',\s*'([^']+)',\s*'[^']*',\s*'([^']*)'", _area_sql)]

# 시뮬레이터 의사결정 트리
_sim = admin[admin.index('const simulatorOptionsConfig = ['):]
_sim = _sim[:_sim.index('\n    ];') + 8]
SIM = []
for g in re.finditer(r'group:\s*"([^"]+)",\s*options:\s*\[(.*?)\]\}', _sim, re.S):
    for o in re.finditer(r'id:\s*"([^"]+)",\s*text:\s*"([^"]+)"', g.group(2)):
        SIM.append((o.group(1), g.group(1), o.group(2)))

# ── 시트 정의 ─────────────────────────────────────────────────────
# (헤더, 설명, 폭, 드롭다운 목록 or None)
# allowBlank 이라 빈 값은 이미 허용된다. 목록에 ''를 넣으면 「O,」가 되어
# 드롭다운에 정체 모를 빈 항목이 하나 생긴다.
YN = ['O']

BASIC = [
    ('솔루션명 *',       '벤더/제품 공식 표기. 버전·에디션은 빼주세요',                    22, None),
    ('4-Layer 분류 *',   '아키텍처상 어느 층인가',                                        30, options('sol-layer')),
    ('제공 형태',        '예) SaaS/API · SW(On-prem) · Hybrid',                           18, None),
    ('MZC 시너지',       'MZC 오퍼링·MSP 와 얼마나 맞물리나',                             12, options('sol-synergy')),
    ('카테고리',         '예) GenAI / 범용 LLM / AI 거버넌스',                            18, None),
    ('밸류체인 위치',    '예) AI Application / Model / Data',                             18, None),
    ('핵심 JTBD *',      '이 제품이 해결하는 일 한 줄. 기능 나열이 아니라 고객의 목적',   34, None),
    ('서비스 급',        '모르면 비워두세요',                                            10, options('sol-grade')),
    ('규모급',           '모르면 비워두세요',                                            12, options('sol-scale')),
    ('포컬 담당',        'MZC 내부 담당자 이름. 없으면 비워두세요',                       14, None),
    ('운영 상태',        '지금 팔 수 있는 상태인가',                                      18, options('sol-status-op')),
    ('가격 종류',        '딜 시뮬레이터 계산 방식',                                       22, options('sol-price-type')),
    ('단가',             '숫자만. 좌석형=1좌석 월단가, 일회성=구축비, MRR=월 운영비',     14, None),
    ('통화',             '',                                                             22, options('sol-currency')),
    ('구간(볼륨) 단가',  '좌석형만. 평문으로 적으세요 — 예) 75석까지 정액 1,000만 / '
                         '1,000석까지 1인 146,000 / 그 이상 1인 59,000',                  30, None),
    ('실단가 확정',      '확정이면 O. 비우면 견적에 「별도협의」로 나가고 금액에서 빠집니다', 12, YN),
    ('기술 제약',        '연동·보안·제공 범위에서 걸리는 것',                             30, None),
    ('벤더 담당·이력',   '벤더 담당자와 협의 이력',                                       26, None),
]
BASIC += [(f'업종: {name}', '해당하면 O', 14, YN) for name in INDUSTRIES]
BASIC += [('MZC 내부 의견', '전략·마진 코멘트. ⚠ 고객에게 노출되지 않습니다', 34, None)]

SECTIONS = [
    ('§1 솔루션 개요 / 핵심 차별점', '제공 형태·카테고리·JTBD 와 **차별적 비즈니스 가치**. '
     '여기 「① 라벨: 설명」 형식으로 쓴 것이 세일즈 피치의 강점 3줄로 그대로 나갑니다'),
    ('§1 내부 코멘트',              '🔒 고객 미노출. AI Tech 의견 등'),
    ('§2 4-Layer 포지셔닝 매핑',    'Primary/Secondary 층과 판단 근거'),
    ('§3 적합 고객 / 산업군 / 페르소나', '「○ 매우 적합」 산업을 반드시 표시. 의사결정 페르소나도'),
    ('§4 레퍼런스 아키텍처',        '고객 인프라와 어떻게 붙는가'),
    ('§5 유즈케이스 / 도입 시나리오', 'UC별 기대효과와 MZC 역할'),
    ('§6 경쟁 솔루션 비교',         '강점·약점·적합도'),
    ('§7 도입 검토 체크리스트',     '필수 요건과 부적합 신호'),
    ('§8 영업 Tip / FAQ',           '8.1 설득 화법 · 8.2 FAQ. 화법은 피치 부록에 그대로 나갑니다'),
    ('§8 내부 코멘트',              '🔒 고객 미노출. 마진·딜사이즈 전략'),
]

JUDGE = [
    ('역할 슬롯 *',   '「선택지」 시트의 슬롯 ID 를 적으세요. **없으면 추천 후보가 되지 않습니다**', 22, None),
    ('번들 확장성',   'SI·MSP 와 얼마나 묶이나',                                                    24, options('sol-bundle-potential')),
]
JUDGE += [(f'{aid} {name}', f'{concern}', 13, ['0', '1', '2', '3']) for aid, name, concern in AREAS]
JUDGE += [
    ('전제 조건',     '이 제품이 **요구하는** 것. 한 줄에 하나씩 평문으로. '
                      '예) 보안 게이트웨이(SWG) 보유 / 최소 150석 / 법무 검토 완료',              34, None),
    ('부적합 신호',   '이럴 땐 **제안하면 안 된다** + 대신 무엇을. 「신호 → 대안」 형식. '
                      '예) SWG 미보유·도입계획 없음 → Zscaler 또는 도입 보류',                     34, None),
]

SIMSHEET = [
    ('시뮬레이터 해당 옵션', '「선택지」 시트의 옵션 ID 를 쉼표로. 예) q1_3, q4_2', 60, None),
]

# ── xlsx ──────────────────────────────────────────────────────────
esc = lambda v: H.escape(str(v), quote=False)
col_ref = lambda n: (chr(65 + n) if n < 26 else chr(64 + n // 26) + chr(65 + n % 26))

def sheet_xml(cols, rows, freeze_col=1, extra_rows=0, validations=True):
    """cols: (헤더, 설명, 폭, 목록) · rows: 데이터 행(보통 빈 문자열)"""
    def row_xml(cells, index, style):
        out = []
        for c, v in enumerate(cells):
            out.append(f'<c r="{col_ref(c)}{index}" t="inlineStr" s="{style}">'
                       f'<is><t xml:space="preserve">{esc(v)}</t></is></c>')
        return f'<row r="{index}"{" ht=\"46\" customHeight=\"1\"" if index == 2 else ""}>' + ''.join(out) + '</row>'

    widths = ''.join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>'
                     for i, (_, _, w, _) in enumerate(cols))
    body = [row_xml([c[0] for c in cols], 1, 1), row_xml([c[1] for c in cols], 2, 2)]
    for n in range(extra_rows):
        body.append(row_xml([''] * len(cols), 3 + n, 0))

    dv = ''
    if validations:
        items = []
        for i, (_, _, _, choices) in enumerate(cols):
            if not choices:
                continue
            # 엑셀 인라인 목록은 쉼표로 값을 가른다. 선택지에 쉼표가 있으면 조용히
            # 쪼개져 이상한 항목이 생긴다 — 그럴 땐 검증을 아예 안 건다.
            if any(',' in c for c in choices):
                continue
            joined = ','.join(choices)
            if len(joined) > 250:      # 인라인 목록 한도. 넘으면 「선택지」 시트를 보게 둔다
                continue
            ref = f'{col_ref(i)}3:{col_ref(i)}{2 + extra_rows}'
            items.append(f'<dataValidation type="list" allowBlank="1" showInputMessage="1" '
                         f'showErrorMessage="1" sqref="{ref}"><formula1>"{esc(joined)}"</formula1></dataValidation>')
        if items:
            dv = f'<dataValidations count="{len(items)}">' + ''.join(items) + '</dataValidations>'

    last = col_ref(len(cols) - 1)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0">'
            f'<pane xSplit="{freeze_col}" ySplit="2" topLeftCell="{col_ref(freeze_col)}3" '
            'activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
            '<sheetFormatPr defaultRowHeight="15"/>'
            f'<cols>{widths}</cols><sheetData>' + ''.join(body) + '</sheetData>'
            f'<autoFilter ref="A1:{last}1"/>{dv}</worksheet>')

def plain_sheet(headers, rows, widths):
    def row_xml(cells, index, style):
        out = [f'<c r="{col_ref(c)}{index}" t="inlineStr" s="{style}"><is><t xml:space="preserve">{esc(v)}</t></is></c>'
               for c, v in enumerate(cells)]
        return f'<row r="{index}">' + ''.join(out) + '</row>'
    w = ''.join(f'<col min="{i+1}" max="{i+1}" width="{x}" customWidth="1"/>' for i, x in enumerate(widths))
    body = [row_xml(headers, 1, 1)] + [row_xml(r, n, 0) for n, r in enumerate(rows, 2)]
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" '
            'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            f'<cols>{w}</cols><sheetData>' + ''.join(body) + '</sheetData></worksheet>')

STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
 '<fonts count="3">'
 '<font><sz val="10"/><name val="맑은 고딕"/></font>'
 '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>'
 '<font><sz val="9"/><color rgb="FF6B7684"/><name val="맑은 고딕"/></font>'
 '</fonts>'
 '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
 '<fill><patternFill patternType="solid"><fgColor rgb="FF16233A"/><bgColor indexed="64"/></patternFill></fill>'
 '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F8"/><bgColor indexed="64"/></patternFill></fill></fills>'
 '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
 '<cellXfs count="3">'
 '<xf xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
 '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
 '<xf xfId="0" fontId="2" fillId="3" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
 '</cellXfs></styleSheet>')

def build(out_path, rows):
    guide = [
        ['① 이 파일은?', '솔루션(ISV) 한 종을 카탈로그에 올리기 위해 필요한 내용을 모으는 서식입니다. '
                          '한 행이 솔루션 한 종입니다. 아는 것만 채우고 모르는 칸은 비워두세요 — '
                          '**추측해서 채운 값이 빈 칸보다 나쁩니다.**'],
        ['② 어디부터?', '「1_기본정보」의 * 표시 항목(솔루션명·4-Layer·JTBD)과 「2_본문8탭」의 §1, '
                          '「3_판정데이터」의 역할 슬롯·평가영역부터 채워주세요.'],
        ['③ 발행이 막히는 항목', '아래 중 하나라도 비면 카탈로그에 못 올립니다.'],
        ['', '· 역할 슬롯 — 없으면 추천 후보가 되지 않습니다'],
        ['', '· 덮는 평가영역(A01~A10) — 하나도 없으면 무엇을 해결하는지 알 수 없습니다'],
        ['', '· 부적합 신호에 대안이 없는 경우 — 제외만 하고 대안이 없으면 영업이 쓸 수 없습니다'],
        ['', '· 본문에 {변수}·TODO·"여기에 입력" 같은 자리표시자가 남은 경우'],
        ['', '· 다른 솔루션 본문을 그대로 베낀 문단이 있는 경우'],
        ['④ JSON 안 씁니다', '전제 조건·부적합 신호·구간 단가는 **평문으로** 적어주세요. '
                          'ISSU 가 시스템 형식으로 옮깁니다. 형식을 맞추려다 틀리는 것보다 낫습니다.'],
        ['⑤ 내부 전용', '「MZC 내부 의견」과 「§1·§8 내부 코멘트」는 고객에게 노출되지 않습니다. '
                          '마진·전략 이야기는 반드시 이 칸에만 쓰세요 — 본문에 쓰면 고객 문서로 나갑니다.'],
        ['⑥ 선택지', '드롭다운이 없는 칸(역할 슬롯·시뮬레이터 옵션)은 「선택지」 시트에서 ID 를 찾아 적으세요.'],
        ['⑦ 다 채우면', '파일 그대로 ISSU 에 보내주세요. 시스템 등록은 ISSU 가 합니다.'],
    ]
    picks = ([('── 역할 슬롯 (3_판정데이터)', '', '')]
             + [(sid, name, layer) for sid, name, layer in SLOTS]
             + [('', '', ''), ('── 평가영역 (3_판정데이터 · 강도 0~3)', '', '')]
             + [(aid, name, f'주요 우려: {concern}') for aid, name, concern in AREAS]
             + [('', '', ''), ('── 강도 기준', '', '')]
             + [('0', '해당 없음', '이 영역을 다루지 않는다'),
                ('1', '약함', '일부만 다룬다'),
                ('2', '보통', '표준 기능으로 다룬다'),
                ('3', '강함', '이 제품의 핵심 강점이다')]
             + [('', '', ''), ('── 시뮬레이터 옵션 (4_시뮬레이터매핑)', '', '')]
             + [(oid, group, text) for oid, group, text in SIM])

    sheets = [
        ('읽어주세요',      plain_sheet(['', '내용'], guide, [22, 110])),
        ('1_기본정보',      sheet_xml(BASIC, [], 1, rows)),
        ('2_본문8탭',       sheet_xml([('솔루션명 *', '1_기본정보 와 같은 이름', 22, None)]
                                      + [(h, d, 60, None) for h, d in SECTIONS], [], 1, rows)),
        ('3_판정데이터',    sheet_xml([('솔루션명 *', '1_기본정보 와 같은 이름', 22, None)] + JUDGE, [], 1, rows)),
        ('4_시뮬레이터매핑', sheet_xml([('솔루션명 *', '1_기본정보 와 같은 이름', 22, None)] + SIMSHEET, [], 1, rows)),
        ('선택지',          plain_sheet(['ID', '이름', '설명'], picks, [16, 34, 70])),
    ]

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        overrides = ''.join(
            f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for i in range(len(sheets)))
        z.writestr('[Content_Types].xml',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          + overrides +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
        z.writestr('_rels/.rels',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
          + ''.join(f'<sheet name="{esc(n)}" sheetId="{i+1}" r:id="rId{i+1}"/>' for i, (n, _) in enumerate(sheets))
          + '</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          + ''.join(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i+1}.xml"/>'
                    for i in range(len(sheets)))
          + f'<Relationship Id="rId{len(sheets)+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr('xl/styles.xml', STYLES)
        for i, (_, xml) in enumerate(sheets):
            z.writestr(f'xl/worksheets/sheet{i+1}.xml', xml)
    return sheets

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', type=int, default=25, help='입력 행 수')
    ap.add_argument('--out', default=ROOT + 'docs/solution-survey-template.xlsx')
    args = ap.parse_args()
    sheets = build(args.out, args.rows)
    print(args.out)
    print(f'시트 {len(sheets)}장 · 입력 행 {args.rows}')
    print(f'  1_기본정보      {len(BASIC)}열 (업종 {len(INDUSTRIES)} 포함)')
    print(f'  2_본문8탭       {len(SECTIONS)}열')
    print(f'  3_판정데이터    {len(JUDGE)}열 (평가영역 {len(AREAS)} 포함)')
    print(f'  선택지          슬롯 {len(SLOTS)} · 평가영역 {len(AREAS)} · 시뮬레이터 {len(SIM)}')
