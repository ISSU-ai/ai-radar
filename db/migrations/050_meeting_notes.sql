-- 050. 회의록
--
-- 인계 브리프가 요구하는 워크플로·이해관계자·제약은 **전부 회의록에 있는데 붙일 자리가
-- 없다.** 지금 자유 텍스트는 customer_meta.notes 하나뿐인데 그건 쓸 수 없다 —
-- **고객용 키트 §2 에 그대로 나간다.** 거기 회의록을 담으면 내부 대화가 고객에게 간다.
--
-- ⚠ **원문을 요약해서 저장하지 않는다.** 요약하는 순간 고객의 말이 영업의 말이 된다.
--   인계받는 사람이 되짚을 수 있어야 하므로 붙여넣은 그대로 둔다.
--
-- ⚠ **참석자 칸을 만들지 않는다.** 만드는 순간 개인정보 「수집」이 되고 고지 대상이
--   된다. 본문에 이름이 적히는 것은 영업이 쓴 문서이고, 이해관계자는 STEP06 에서
--   역할로 받는다. 입력칸에 경고 문구를 둔다.
--
-- ⚠ **met_on 이 필수다.** 3개월 전 이야기와 지난주 이야기는 무게가 다르다. 인계받는
--   사람이 가장 먼저 보는 것이 날짜다. created_at 으로 대신할 수 없다 — 미팅한 날과
--   적어 넣은 날이 다르다.
--
-- ⚠ **on delete cascade 를 여기서는 쓴다.** migrations.md 의 cascade 금지는 「뭐가
--   딸려 지워지는지 모르는 채 지우는 것」을 막는 규칙이다. 여기는 딜의 자식이 이 표
--   하나뿐이고 **명시적으로 알고** 거는 것이라 해당하지 않는다. 딜이 사라졌는데
--   회의록만 남으면 주인 없는 고객 대화가 DB 에 남는다.
--
-- deals 의 첫 자식 표다. 지금까지 딜은 컬럼만으로 커 왔다.
--
-- 표만 만든다. apply-migrations.js 에 넣어도 안전하다.

begin;

create table if not exists meeting_notes (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references deals(id) on delete cascade,
  met_on     date not null,                       -- 미팅한 날. 적어 넣은 날이 아니다
  kind       text not null default 'meeting'
             check (kind in ('meeting', 'call', 'mail', 'visit')),
  title      text,
  body       text not null,                       -- 붙여넣은 원문 그대로
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table meeting_notes is
  '미팅 원문. **내부용이다** — 고객용 키트는 이 표를 읽지 않는다. customer_meta.notes 와 저장소가 다른 이유가 그것이다';
comment on column meeting_notes.body is
  '붙여넣은 원문. **요약해서 저장하지 않는다** — 요약하면 고객의 말이 영업의 말이 된다. 인계 브리프는 여기서 발췌한 인용을 근거로 단다';
comment on column meeting_notes.met_on is
  '미팅한 날. created_at(적어 넣은 날)과 다르다. 언제 들은 이야기인지가 값의 무게를 정한다';

create index if not exists idx_meeting_notes_deal on meeting_notes (deal_id, met_on desc);

alter table meeting_notes enable row level security;

-- 딜과 같은 모양. 읽기는 승인 사용자, 쓰기는 딜 담당자나 admin.
-- 라우트는 이보다 좁게(담당자·admin·미배정) 건다 — 딜 상세와 같은 게이트다.
drop policy if exists meeting_notes_read on meeting_notes;
create policy meeting_notes_read on meeting_notes for select using (is_approved());

drop policy if exists meeting_notes_write on meeting_notes;
create policy meeting_notes_write on meeting_notes for all
  using (exists (select 1 from deals d where d.id = deal_id
                   and (d.owner_id = auth.uid() or is_admin())))
  with check (exists (select 1 from deals d where d.id = deal_id
                   and (d.owner_id = auth.uid() or is_admin())));

commit;

-- 확인
-- 1) 표가 생겼는가.
select column_name, data_type, is_nullable from information_schema.columns
 where table_schema = current_schema() and table_name = 'meeting_notes'
 order by ordinal_position;
--
-- 2) 아직 비어 있다. 허브 딜 화면에서 넣는다.
select count(*) as "회의록" from meeting_notes;
--
-- 3) 딜별 분포. 「미팅은 했는데 회의록이 없는 딜」이 인계 준비가 안 된 딜이다.
select d.customer, count(n.id) as "회의록",
       max(n.met_on) as "마지막 미팅",
       sum(length(n.body)) as "글자수"
  from deals d left join meeting_notes n on n.deal_id = d.id
 where d.deleted_at is null
 group by d.id, d.customer order by count(n.id) desc, d.customer limit 20;
--
-- 4) ⚠ 고아 행이 있으면 안 된다. cascade 가 걸려 있어 0건이어야 한다.
select count(*) as "주인 없는 회의록"
  from meeting_notes n left join deals d on d.id = n.deal_id where d.id is null;
