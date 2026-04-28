# 実装報告書: 利用予定印刷改善 + Phase 64「キャンセル待ち (waitlist)」機能

最終更新: 2026-04-28
コミット: `b65002d` (印刷改善) → `c8fd26d` (Phase 64)

---

## 0. 全体サマリ

このセッションで実施した変更は大きく **3 系統**:

1. **利用予定の印刷レイアウト全面リライト**（`b65002d`）
2. **Phase 64: キャンセル待ち (waitlist) 出欠ステータス**（`c8fd26d`）
3. 上記に付随する **副次バグ修正・UI 改善**:
   - 利用予定の日付色バグ修正（土=青/日=赤）
   - 日次出力の個別エリア絵文字 lookup miss 修正
   - 日次出力の「休憩」セクション削除
   - シフト生成ロジックの利用人数集計に absent/leave/waitlist 除外

すべて Next.js 15 (App Router) + Supabase + TypeScript + Tailwind CSS 構成での実装。

---

## 1. 利用予定の印刷レイアウト全面リライト

### 1.1 経緯
利用予定 (`/schedule`) を A3 横で印刷した際、以下の崩れがあった:
- MonthStepper（月ナビ）が印刷に表示されてしまう
- フォント 6.5pt + padding 0 で日付ヘッダがほぼ見えない
- 行を 16px に強制圧縮、日付ヘッダの 3 段構造を 1 段化
- 1 ページ強制収納で逆に縦が破綻
- 利用数行（`bottom-0` sticky）が印刷で位置ズレ

ユーザー指示: 「見やすく印刷してほしいな、もう少し縦長くていいからさ」

### 1.2 変更内容

**`src/app/(app)/schedule/page.tsx`**

MonthStepper コンテナに `print-hide` クラスを追加（globals.css の共通ルールで `display:none`）:

```tsx
<div className="px-6 pt-3 print-hide" data-tour="month-stepper">
  <MonthStepper defaultMonth={defaultCurrentMonthStr()} />
</div>
```

印刷 CSS 全面書き直し（要点）:

```css
@media print {
  @page { size: A3 landscape; margin: 8mm; }
  .schedule-print-root table {
    font-size: 9pt !important;  /* 6.5pt → 9pt で読める大きさ */
    table-layout: fixed !important;
    border-collapse: collapse !important;
  }
  /* thead を各ページに繰り返し表示 */
  .schedule-print-root thead { display: table-header-group !important; }
  .schedule-print-root tfoot { display: table-footer-group !important; }
  /* 行は途中で改ページしない、ただし tbody 全体は分割可 */
  .schedule-print-root tr {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .schedule-print-root th, .schedule-print-root td {
    padding: 3px 2px !important;
    font-size: 9pt !important;
    line-height: 1.25 !important;
  }
  /* 児童名 1 段目 (名前) + 2 段目 (学年) を維持 */
  .schedule-print-root tbody td:first-child > div:nth-child(2) {
    font-size: 7pt !important;
  }
  /* セル内 迎/送 を画面同様の縦 2 段表示 (横圧縮を解除) */
  .schedule-print-root tbody td .flex.flex-col {
    flex-direction: column !important;
    line-height: 1.2 !important;
  }
  /* 氏名列を広く */
  .schedule-print-root thead th:first-child,
  .schedule-print-root tbody td:first-child {
    width: 90px !important;
  }
  /* 日付ヘッダ 営/休 + M/d + 曜日 の 3 段表示を維持 */
  .schedule-print-root thead th > div:nth-child(1) { font-size: 6.5pt !important; }
  .schedule-print-root thead th > div:nth-child(2) { font-size: 9pt !important; font-weight: 700 !important; }
  .schedule-print-root thead th > div:nth-child(3) { font-size: 7pt !important; }
  /* sticky 解除 (利用数行 + キャンセル待ち行が bottom-0) */
  .schedule-print-root thead th,
  .schedule-print-root tbody td,
  .schedule-print-root tbody tr:last-child td,
  .schedule-print-root tbody tr:nth-last-child(2) td {
    position: static !important;
    box-shadow: none !important;
  }
}
```

### 1.3 設計ポイント
- 「縦に伸びて複数ページになって良い」前提で、1 ページ詰め込み圧縮を完全廃止
- `display: table-header-group` で thead を各ページに自動繰り返し
- `tr { page-break-inside: avoid }` で 1 児童分の行は分断しない
- sticky は CSS で `position: static !important` に強制解除

---

## 2. Phase 64: キャンセル待ち (waitlist) 機能

### 2.1 ビジネスルール

| 項目 | 仕様 |
|---|---|
| 既存ステータス | `planned` `present` `absent` `late` `early_leave` `leave` |
| **新ステータス** | `waitlist`（キャンセル待ち） |
| 順番 | 1〜10 を持てる。**同日内で重複可（兄弟想定）** |
| 時刻 | 入力可（利用に切替時に時刻が引き継がれる） |
| 送迎担当 | 不可（`present` に昇格してから割り当てる運用） |
| 利用切替 | 確認モーダル経由で `present` に昇格 → 全画面に即時反映 |
| 印刷 | ブロック化せず軽量レイアウトで配置 |

### 2.2 影響ファイル一覧（19 ファイル）

| 種別 | ファイル |
|---|---|
| マイグレーション | `supabase/migrations/0041_attendance_waitlist.sql` (新規) |
| 型 | `src/types/index.ts` |
| API | `src/app/api/schedule-entries/[id]/attendance/route.ts` |
| API (SELECT 拡張 ×4) | `src/app/api/schedule-entries/route.ts`<br>`src/app/api/schedule-page-data/route.ts`<br>`src/app/api/transport-page-data/route.ts`<br>`src/app/api/shift-page-data/route.ts` |
| 利用予定 | `src/app/(app)/schedule/page.tsx`<br>`src/components/schedule/ScheduleGrid.tsx` |
| 送迎表 | `src/app/(app)/transport/page.tsx` |
| シフト表 | `src/app/(app)/shift/page.tsx`<br>`src/components/shift/ShiftGrid.tsx`<br>`src/lib/logic/generateShift.ts` |
| 日次出力 | `src/app/(app)/output/daily/page.tsx` |
| 週次送迎 | `src/app/(app)/output/weekly-transport/page.tsx` |
| デモバックエンド | `src/lib/demo/demoBackend.ts`<br>`src/lib/demo/seedData.ts` |
| 進捗表 | `docs/progress.html` |

---

### 2.3 DB マイグレーション

**`supabase/migrations/0041_attendance_waitlist.sql`** 全文:

```sql
-- 1) attendance_status の CHECK 制約を貼り直し
alter table public.schedule_entries
  drop constraint if exists schedule_entries_attendance_status_check;
alter table public.schedule_entries
  add constraint schedule_entries_attendance_status_check
    check (attendance_status in (
      'planned', 'present', 'absent', 'late', 'early_leave', 'leave', 'waitlist'
    ));

comment on column public.schedule_entries.attendance_status is
  '出欠ステータス。planned=予定／present=出席／absent=欠席／late=遅刻／early_leave=早退／leave=お休み／waitlist=キャンセル待ち';

-- 2) waitlist_order カラム追加 (1〜10、waitlist 以外は NULL を強制)
alter table public.schedule_entries
  add column if not exists waitlist_order smallint null;
alter table public.schedule_entries
  drop constraint if exists schedule_entries_waitlist_order_range;
alter table public.schedule_entries
  add constraint schedule_entries_waitlist_order_range
    check (waitlist_order is null or (waitlist_order between 1 and 10));
alter table public.schedule_entries
  drop constraint if exists schedule_entries_waitlist_order_only_for_waitlist;
alter table public.schedule_entries
  add constraint schedule_entries_waitlist_order_only_for_waitlist
    check (waitlist_order is null or attendance_status = 'waitlist');

comment on column public.schedule_entries.waitlist_order is
  'Phase 64: キャンセル待ちの順番 (1〜10)。waitlist 以外は NULL。同日内で重複可（兄弟想定）。';

-- 3) RPC 拡張: 第3引数 p_waitlist_order を追加。既存の 2 引数呼び出しはデフォルト NULL でそのまま動作。
create or replace function public.update_schedule_entry_attendance(
  p_entry_id uuid,
  p_status text,
  p_waitlist_order smallint default null
) returns public.schedule_entries
language plpgsql security definer set search_path = public
as $$
declare
  v_staff record;
  v_entry public.schedule_entries;
  v_old_status text;
  v_new_order smallint;
begin
  -- セッションから職員情報取得（退職者・未ログインは弾かれる）
  select id, tenant_id, name into v_staff
    from public.staff where user_id = auth.uid() and is_active = true limit 1;
  if v_staff.id is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  if p_status not in ('planned','present','absent','late','early_leave','leave','waitlist') then
    raise exception '不正な出欠ステータスです: %', p_status using errcode = '22023';
  end if;

  -- waitlist 以外では order を強制 NULL
  if p_status = 'waitlist' then
    if p_waitlist_order is not null and (p_waitlist_order < 1 or p_waitlist_order > 10) then
      raise exception 'キャンセル待ちの順番は 1〜10 で指定してください' using errcode = '22023';
    end if;
    v_new_order := p_waitlist_order;
  else
    v_new_order := null;
  end if;

  -- entry 取得 (tenant 一致チェック)
  select * into v_entry from public.schedule_entries
    where id = p_entry_id and tenant_id = v_staff.tenant_id for update;
  if v_entry.id is null then
    raise exception '対象の利用予定が見つかりません' using errcode = 'P0002';
  end if;

  v_old_status := v_entry.attendance_status;

  -- 変更なし (status も order も同一) ならスキップ
  if v_old_status = p_status and coalesce(v_entry.waitlist_order, -1) = coalesce(v_new_order, -1) then
    return v_entry;
  end if;

  update public.schedule_entries
    set attendance_status = p_status,
        waitlist_order = v_new_order,
        attendance_updated_at = now(),
        attendance_updated_by = v_staff.id
    where id = p_entry_id returning * into v_entry;

  -- 履歴は status 変更時のみ記録 (order だけの変更は履歴を膨らませないため記録しない)
  if v_old_status <> p_status then
    insert into public.attendance_audit_logs (
      tenant_id, schedule_entry_id, child_id, entry_date,
      changed_by_staff_id, changed_by_name, old_status, new_status
    ) values (
      v_entry.tenant_id, v_entry.id, v_entry.child_id, v_entry.date,
      v_staff.id, v_staff.name, v_old_status, p_status
    );
  end if;

  return v_entry;
end;
$$;
```

**設計判断**:
- **uniq 制約なし**: 兄弟で同日 ① が 2 人あり得るため、`(date, waitlist_order)` のユニーク制約は付けない
- **CHECK 2 つ**: `1 <= waitlist_order <= 10` と `waitlist_order != NULL → status = 'waitlist'`
- **履歴は status 変更時のみ記録**: 順番だけの変更で `attendance_audit_logs` が膨れないように

---

### 2.4 型定義 `src/types/index.ts`

```ts
export type AttendanceStatus =
  | 'planned'      /* 予定（未確認） */
  | 'present'      /* 出席 */
  | 'absent'       /* 欠席 */
  | 'late'         /* 遅刻 */
  | 'early_leave'  /* 早退 */
  | 'leave'        /* お休み */
  | 'waitlist';    /* Phase 64: キャンセル待ち */

export type ScheduleEntryRow = {
  id: string;
  tenant_id: string;
  child_id: string;
  date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  pickup_method: ScheduleEntryPickupMethod;
  dropoff_method: ScheduleEntryDropoffMethod;
  pickup_mark: string | null;
  dropoff_mark: string | null;
  is_confirmed: boolean;
  attendance_status: AttendanceStatus;
  attendance_updated_at: string | null;
  attendance_updated_by: string | null;
  /** Phase 64: 1〜10、waitlist 以外は null */
  waitlist_order: number | null;
  created_at: string;
};
```

---

### 2.5 API: ステータス更新 `PATCH /api/schedule-entries/[id]/attendance`

**`src/app/api/schedule-entries/[id]/attendance/route.ts`**:

```ts
const VALID_STATUSES: AttendanceStatus[] = [
  'planned', 'present', 'absent', 'late', 'early_leave', 'leave', 'waitlist',
];

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAuthenticated();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const status = body?.status as AttendanceStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: '不正な出欠ステータスです' }, { status: 400 });
  }

  // waitlist_order: status='waitlist' のときのみ受け取る
  let waitlistOrder: number | null = null;
  const rawOrder = body?.waitlist_order;
  if (status === 'waitlist' && rawOrder != null) {
    const n = Number(rawOrder);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return NextResponse.json(
        { error: 'キャンセル待ちの順番は 1〜10 で指定してください' },
        { status: 400 },
      );
    }
    waitlistOrder = n;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('update_schedule_entry_attendance', {
    p_entry_id: id,
    p_status: status,
    p_waitlist_order: waitlistOrder,
  });

  if (error) {
    const code = error.code;
    const httpStatus =
      code === '42501' ? 401 : code === 'P0002' ? 404 : code === '22023' ? 400 : 500;
    return NextResponse.json({ error: error.message ?? '出欠の更新に失敗しました' }, { status: httpStatus });
  }
  return NextResponse.json({ entry: data });
}
```

---

### 2.6 API: SELECT 句に `waitlist_order` 追加（4 ルート）

**`src/app/api/schedule-entries/route.ts`**:
```ts
const cols = dto === 'transport'
  ? 'id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, attendance_status, waitlist_order'
  : 'id, tenant_id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, pickup_mark, dropoff_mark, is_confirmed, attendance_status, attendance_updated_at, attendance_updated_by, waitlist_order, created_at';
```

**`src/app/api/schedule-page-data/route.ts`**:
```ts
.select('id, tenant_id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, pickup_mark, dropoff_mark, is_confirmed, attendance_status, attendance_updated_at, attendance_updated_by, waitlist_order, created_at')
```

**`src/app/api/transport-page-data/route.ts`**:
```ts
.select('id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, attendance_status, waitlist_order')
```

**`src/app/api/shift-page-data/route.ts`**:
```ts
.select('id, tenant_id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, attendance_status, waitlist_order, created_at')
```

---

### 2.7 利用予定ページ `/schedule`

#### 2.7.1 `src/app/(app)/schedule/page.tsx`

**LABELS / COLORS に `waitlist` を追加**:
```ts
const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  planned: '予定', present: '出席', absent: '欠席',
  late: '遅刻', early_leave: '早退', leave: 'お休み',
  waitlist: 'キャンセル待ち',
};
const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  planned: 'var(--ink-3)', present: 'var(--green)', absent: 'var(--red)',
  late: 'var(--gold)', early_leave: 'var(--accent)', leave: 'var(--ink-3)',
  waitlist: 'var(--ink-3)',  // グレー寄せ
};
```

**`CellData` 型に `waitlist_order` 追加**:
```ts
type CellData = {
  entry_id: string | null;
  child_id: string;
  date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  pickup_method: 'self' | 'pickup';
  dropoff_method: 'self' | 'dropoff';
  attendance_status: AttendanceStatus;
  waitlist_order: number | null;  // Phase 64
  note: string | null;
};
```

**State 追加**:
```ts
const [waitlistOrder, setWaitlistOrder] = useState<number | null>(null);
```

**`fetchAll` のセルマッピング**:
```ts
setCells(entries.map<CellData>((e) => ({
  entry_id: e.id, child_id: e.child_id, date: e.date,
  pickup_time: e.pickup_time, dropoff_time: e.dropoff_time,
  pickup_method: e.pickup_method === 'self' ? 'self' : 'pickup',
  dropoff_method: e.dropoff_method === 'self' ? 'self' : 'dropoff',
  attendance_status: e.attendance_status ?? 'planned',
  waitlist_order: e.waitlist_order ?? null,  // Phase 64
  note: null,
})));
```

**`handleCellClick` で復元**:
```ts
setWaitlistOrder(cellData?.waitlist_order ?? null);
```

**`handleAttendanceChange` を 2 引数に拡張**:
```ts
const handleAttendanceChange = async (
  next: AttendanceStatus,
  nextOrder: number | null = null,
) => {
  if (!selectedCell) return;
  const cell = cells.find(c => c.child_id === selectedCell.childId && c.date === selectedCell.date);
  setAttendanceBusy(true);
  try {
    let entryId = cell?.entry_id ?? null;

    // 空セルなら entry を空で作成 (既存ロジック)
    if (!entryId) {
      const createRes = await fetch('/api/schedule-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [{
            child_id: selectedCell.childId, date: selectedCell.date,
            pickup_time: null, dropoff_time: null,
            pickup_method: 'pickup', dropoff_method: 'dropoff',
          }],
        }),
      });
      // ... entry id 取得
    }

    // waitlist 以外では order を強制 NULL
    const orderToSend = next === 'waitlist' ? nextOrder : null;
    const res = await fetch(`/api/schedule-entries/${entryId}/attendance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next, waitlist_order: orderToSend }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? '更新失敗');

    setAttendanceStatus(next);
    setWaitlistOrder(orderToSend);
    setCells(prev => prev.map(c =>
      c.entry_id === entryId
        ? { ...c, attendance_status: next, waitlist_order: orderToSend }
        : c,
    ));
  } catch (e) {
    alert(e instanceof Error ? e.message : '更新失敗');
  } finally {
    setAttendanceBusy(false);
  }
};
```

**モーダル UI: キャンセル待ちの注意書き**:
```jsx
{attendanceStatus !== 'absent' && attendanceStatus !== 'leave' && (
  <>
    {attendanceStatus === 'waitlist' && (
      <div className="px-3 py-2 rounded text-xs font-semibold"
           style={{ background: 'rgba(0,0,0,0.05)',
                    color: 'var(--ink-2)',
                    border: '1px dashed var(--rule-strong)' }}>
        この利用時間でキャンセル待ちです{waitlistOrder ? `（順番: ${waitlistOrder} 番）` : ''}
      </div>
    )}
    {/* 時刻入力 (既存) */}
  </>
)}
```

**4 ボタン (`grid-cols-4`)**:
```jsx
<div className="grid grid-cols-4 gap-2">
  {[
    { label: '出席', value: 'present' as AttendanceStatus, color: 'var(--green)' },
    { label: 'お休み', value: 'leave' as AttendanceStatus, color: 'var(--ink-3)' },
    { label: '欠席', value: 'absent' as AttendanceStatus, color: 'var(--red)' },
    { label: 'キャンセル待ち', value: 'waitlist' as AttendanceStatus, color: '#6b7280' },
  ].map((opt) => {
    const on = attendanceStatus === opt.value;
    return (
      <button key={opt.value} type="button" disabled={attendanceBusy}
        onClick={() => {
          // waitlist に切替時は既存 order を維持、それ以外は null
          const carryOrder = opt.value === 'waitlist' ? waitlistOrder : null;
          handleAttendanceChange(opt.value, carryOrder);
        }}
        className="py-3 text-sm font-bold rounded transition-all"
        style={{
          background: on ? opt.color : 'var(--bg)',
          color: on ? '#fff' : 'var(--ink-2)',
          border: `2px solid ${on ? opt.color : 'var(--rule-strong)'}`,
        }}>
        {opt.label}
      </button>
    );
  })}
</div>
```

**順番ピッカー (5×2 grid)**:
```jsx
{attendanceStatus === 'waitlist' && (
  <div className="flex flex-col gap-2 mt-2">
    <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
      順番（同じ番号が複数いてもOK：兄弟など）
    </label>
    <div className="grid grid-cols-5 gap-1.5">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
        const on = waitlistOrder === n;
        return (
          <button key={n} type="button" disabled={attendanceBusy}
            onClick={() => handleAttendanceChange('waitlist', n)}
            className="py-2 text-base font-bold rounded transition-all"
            style={{
              background: on ? '#6b7280' : 'var(--bg)',
              color: on ? '#fff' : 'var(--ink-2)',
              border: `2px solid ${on ? '#6b7280' : 'var(--rule-strong)'}`,
            }}>
            {'①②③④⑤⑥⑦⑧⑨⑩'.charAt(n - 1)}
          </button>
        );
      })}
    </div>
    {waitlistOrder != null && (
      <button type="button" onClick={() => handleAttendanceChange('waitlist', null)}
        className="text-xs font-semibold py-1.5 rounded"
        style={{ background: 'transparent', color: 'var(--ink-3)',
                 border: '1px dashed var(--rule-strong)' }}>
        順番をクリア
      </button>
    )}
  </div>
)}
```

#### 2.7.2 `src/components/schedule/ScheduleGrid.tsx`

**`ScheduleCellData` 型に追加**:
```ts
type ScheduleCellData = {
  child_id: string;
  date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  pickup_method: 'self' | 'pickup';
  dropoff_method: 'self' | 'dropoff';
  note: string | null;
  entry_id?: string | null;
  attendance_status?: 'planned' | 'present' | 'absent' | 'late' | 'early_leave' | 'leave' | 'waitlist';
  waitlist_order?: number | null;
};
```

**日付色バグ修正** (土=青/日=赤):

修正前:
```jsx
color: isTodayCol ? 'var(--accent)' : holiday ? 'var(--red)' : undefined,
```
（`undefined` で `getDowStyle` の色を打ち消していた）

修正後:
```jsx
color: isTodayCol
  ? 'var(--accent)'
  : (holiday || d.dow === 0)
    ? 'var(--red)'
    : d.dow === 6
      ? 'var(--accent)'
      : undefined,
```

**`isWaitlist` 判定とセル描画**:
```jsx
const hasEntry = !!cell && (cell.entry_id ?? null) !== null;
const isAbsent = cell?.attendance_status === 'absent';
const isLeave = cell?.attendance_status === 'leave';
const isWaitlist = cell?.attendance_status === 'waitlist';
const isOff = isLeave || (hasEntry && !hasTimes && !isAbsent && !isWaitlist);

let bg = getCellBg(d.dow);
if (isAbsent) bg = 'var(--red-pale)';
else if (isWaitlist) bg = 'rgba(0,0,0,0.06)';  // グレー
else if (isOff) bg = 'rgba(0,0,0,0.04)';

// 描画分岐
{isAbsent ? (
  <span style={{ color: 'var(--red)' }}>欠席</span>
) : isWaitlist ? (
  <div className="flex flex-col gap-0 leading-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
    <span className="text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
      キャ待{cell?.waitlist_order ? ` ${'①②③④⑤⑥⑦⑧⑨⑩'.charAt(cell.waitlist_order - 1)}` : ''}
    </span>
    {cell?.pickup_time && <span style={{ color: 'var(--ink-3)', fontSize: '0.68rem' }}>{formatHM(cell.pickup_time)}</span>}
    {cell?.dropoff_time && <span style={{ color: 'var(--ink-3)', fontSize: '0.68rem' }}>{formatHM(cell.dropoff_time)}</span>}
  </div>
) : isOff ? (
  <span style={{ color: 'var(--ink-3)' }}>お休み</span>
) : hasTimes ? (...) : (...)}
```

**最下部の利用数行 + キャンセル待ち行**:
```ts
const dailyCounts = new Map<string, number>();
const dailyWaitlistCounts = new Map<string, number>();
dates.forEach((d) => {
  let count = 0, waitlistCount = 0;
  children.forEach((child) => {
    const cell = cellMap.get(`${child.id}_${d.dateStr}`);
    if (!cell) return;
    if (cell.attendance_status === 'waitlist') { waitlistCount++; return; }
    if (cell.pickup_time || cell.dropoff_time) count++;
  });
  dailyCounts.set(d.dateStr, count);
  dailyWaitlistCounts.set(d.dateStr, waitlistCount);
});
const hasAnyWaitlist = Array.from(dailyWaitlistCounts.values()).some((n) => n > 0);
```

```jsx
{/* 利用数行 (既存) */}
<tr>
  <td className="sticky left-0 bottom-0">利用数</td>
  {dates.map(d => <td>{dailyCounts.get(d.dateStr) || ''}</td>)}
</tr>

{/* Phase 64: キャンセル待ち行 (月内に 1 件でも waitlist があれば表示) */}
{hasAnyWaitlist && (
  <tr>
    <td className="sticky left-0 bottom-0 px-4 py-2 font-bold whitespace-nowrap"
        style={{
          background: 'var(--bg)',
          borderTop: '1px dashed var(--rule-strong)',
          color: 'var(--ink-2)',
          fontSize: '0.78rem',
        }}>
      キャンセル待ち
    </td>
    {dates.map((d) => {
      const count = dailyWaitlistCounts.get(d.dateStr) || 0;
      return (
        <td key={d.dateStr} className="sticky bottom-0 text-center font-bold"
            style={{
              borderTop: '1px dashed var(--rule-strong)',
              color: count > 0 ? 'var(--ink-2)' : 'var(--ink-3)',
              fontSize: '0.78rem',
            }}>
          {count > 0 ? count : ''}
        </td>
      );
    })}
  </tr>
)}
```

---

### 2.8 送迎表ページ `/transport`

#### `src/app/(app)/transport/page.tsx`

**フィルタ調整: waitlist は times に関わらず保持**:
```ts
setScheduleEntries(entries.filter((e) => {
  if (e.attendance_status === 'absent') return false;
  if (e.attendance_status === 'leave') return false;
  if (e.attendance_status === 'waitlist') return true;  // Phase 64: 集約行用に保持
  if (!e.pickup_time && !e.dropoff_time) return false;
  return true;
}));
```

**`currentDayEntries` から waitlist 除外**:
```ts
const scheduleIds = scheduleEntries
  .filter((e) => e.date === selectedDate && e.attendance_status !== 'waitlist')
  .map((e) => e.id);
```

**新 useMemo `currentDayWaitlist`**:
```ts
type WaitlistDayEntry = {
  scheduleEntryId: string;
  childId: string;
  childName: string;
  pickupTime: string | null;
  dropoffTime: string | null;
  waitlistOrder: number | null;
};

const currentDayWaitlist: WaitlistDayEntry[] = useMemo(() => {
  const childOrderById = new Map(children.map((c, idx) => [c.id, idx]));
  const rows = scheduleEntries
    .filter((e) => e.date === selectedDate && e.attendance_status === 'waitlist')
    .map<WaitlistDayEntry>((e) => ({
      scheduleEntryId: e.id,
      childId: e.child_id,
      childName: childNameMap.get(e.child_id) ?? '(不明)',
      pickupTime: e.pickup_time,
      dropoffTime: e.dropoff_time,
      waitlistOrder: e.waitlist_order ?? null,
    }));
  rows.sort((a, b) => {
    const oa = a.waitlistOrder ?? 999;
    const ob = b.waitlistOrder ?? 999;
    if (oa !== ob) return oa - ob;
    const ca = childOrderById.get(a.childId) ?? Number.MAX_SAFE_INTEGER;
    const cb = childOrderById.get(b.childId) ?? Number.MAX_SAFE_INTEGER;
    return ca - cb;
  });
  return rows;
}, [selectedDate, scheduleEntries, childNameMap, children]);
```

**確認モーダル state + 切替ハンドラ**:
```ts
const [convertTarget, setConvertTarget] = useState<WaitlistDayEntry | null>(null);
const [converting, setConverting] = useState(false);

const handleConvertWaitlistToPresent = async (target: WaitlistDayEntry) => {
  setConverting(true);
  try {
    const res = await fetch(`/api/schedule-entries/${target.scheduleEntryId}/attendance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'present', waitlist_order: null }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? '切り替えに失敗しました');
    setConvertTarget(null);
    await fetchAll();
  } catch (e) {
    alert(e instanceof Error ? e.message : '切り替えに失敗しました');
  } finally { setConverting(false); }
};
```

**`/api/transport/generate` 入力からも waitlist 除外**:
```ts
const entriesForDate = scheduleEntries.filter(
  (e) => e.date === date && e.attendance_status !== 'waitlist',
);
```

**ヘッダのバッジ「🧒 利用 N人 + ⏳ 待 N人」**:
```jsx
{(() => {
  const dayEntries = scheduleEntries.filter(e =>
    e.date === selectedDate &&
    e.attendance_status !== 'absent' &&
    e.attendance_status !== 'leave' &&
    e.attendance_status !== 'waitlist'  // Phase 64
  );
  const waitlistCount = scheduleEntries.filter(e =>
    e.date === selectedDate && e.attendance_status === 'waitlist'
  ).length;
  return (
    <>
      <span style={{ background: 'var(--bg)', border: '1px solid var(--rule)' }}>
        🧒 利用 {dayEntries.length}人
      </span>
      {waitlistCount > 0 && (
        <span style={{ background: 'var(--bg)', border: '1px dashed var(--rule-strong)' }}>
          ⏳ 待 {waitlistCount}人
        </span>
      )}
    </>
  );
})()}
```

**TransportDayView の下に集約行**:
```jsx
{currentDayWaitlist.length > 0 && (
  <div className="mt-3 px-4 py-3 rounded flex items-center flex-wrap gap-x-4 gap-y-2"
       style={{ background: 'rgba(0,0,0,0.04)',
                border: '1px solid var(--rule)',
                fontSize: '0.85rem' }}>
    <span className="font-bold whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>
      キャンセル待ち
    </span>
    {currentDayWaitlist.map((w) => {
      const orderMark = w.waitlistOrder ? '①②③④⑤⑥⑦⑧⑨⑩'.charAt(w.waitlistOrder - 1) : '－';
      const timeRange = w.pickupTime || w.dropoffTime
        ? `${w.pickupTime ? w.pickupTime.slice(0, 5) : '?'}〜${w.dropoffTime ? w.dropoffTime.slice(0, 5) : '?'}`
        : null;
      return (
        <span key={w.scheduleEntryId} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span style={{ color: 'var(--ink-2)', fontWeight: 700 }}>{orderMark}</span>
          <span>{w.childName}</span>
          {timeRange && (
            <span style={{ color: 'var(--ink-3)', fontSize: '0.78rem' }}>({timeRange})</span>
          )}
          {myRole !== 'viewer' && (
            <button onClick={() => setConvertTarget(w)}
              className="ml-1 text-xs font-semibold px-2 py-0.5 rounded"
              style={{ background: 'var(--white)',
                       color: 'var(--accent)',
                       border: '1px solid var(--accent)' }}>
              利用に変える
            </button>
          )}
        </span>
      );
    })}
  </div>
)}
```

**確認モーダル** (Modal の後に配置):
```jsx
{convertTarget && (
  <Modal isOpen={true}
         onClose={() => (converting ? null : setConvertTarget(null))}
         title="キャンセル待ち → 利用 への切替">
    <div className="flex flex-col gap-4">
      <p className="text-sm" style={{ lineHeight: 1.6 }}>
        <span className="font-bold">{convertTarget.childName}</span> さんを本日の{' '}
        <span className="font-bold" style={{ color: 'var(--green)' }}>利用 (出席)</span>{' '}
        に切り替えます。
      </p>
      <div className="px-3 py-2 rounded text-sm"
           style={{ background: 'var(--bg)', border: '1px solid var(--rule)' }}>
        利用時間:{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {convertTarget.pickupTime ? convertTarget.pickupTime.slice(0, 5) : '?'}
          {' 〜 '}
          {convertTarget.dropoffTime ? convertTarget.dropoffTime.slice(0, 5) : '?'}
        </span>
        <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
          切替後は送迎担当が未割当の状態になります。送迎表で担当を割り当ててください。
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-2">
        <Button variant="secondary" onClick={() => setConvertTarget(null)} disabled={converting}>
          キャンセル
        </Button>
        <Button variant="primary"
                onClick={() => handleConvertWaitlistToPresent(convertTarget)}
                disabled={converting}>
          {converting ? '切替中...' : '利用に変える'}
        </Button>
      </div>
    </div>
  </Modal>
)}
```

---

### 2.9 シフト表 `/shift`

#### 2.9.1 `src/app/(app)/shift/page.tsx`

```ts
const childrenCountByDate = useMemo(() => {
  const m = new Map<string, number>();
  for (const e of scheduleEntries) {
    if (e.attendance_status === 'absent') continue;
    if (e.attendance_status === 'leave') continue;
    if (e.attendance_status === 'waitlist') continue;  // Phase 64
    m.set(e.date, (m.get(e.date) ?? 0) + 1);
  }
  return m;
}, [scheduleEntries]);

// Phase 64: 日別キャンセル待ち児童数
const childrenWaitlistCountByDate = useMemo(() => {
  const m = new Map<string, number>();
  for (const e of scheduleEntries) {
    if (e.attendance_status !== 'waitlist') continue;
    m.set(e.date, (m.get(e.date) ?? 0) + 1);
  }
  return m;
}, [scheduleEntries]);
```

ShiftGrid に渡す:
```jsx
<ShiftGrid
  ...
  childrenCountByDate={childrenCountByDate}
  childrenWaitlistCountByDate={childrenWaitlistCountByDate}
  requestComments={requestComments}
/>
```

#### 2.9.2 `src/components/shift/ShiftGrid.tsx`

```ts
type ShiftGridProps = {
  // ...既存
  childrenCountByDate?: Map<string, number>;
  childrenWaitlistCountByDate?: Map<string, number>;  // Phase 64
  requestComments?: ShiftRequestCommentRow[];
};

export default function ShiftGrid({
  ...,
  childrenCountByDate,
  childrenWaitlistCountByDate,  // Phase 64
  requestComments,
}: ShiftGridProps) { ... }
```

ヘッダ描画:
```jsx
{(() => {
  const childCount = childrenCountByDate?.get(d.dateStr) ?? 0;
  const waitlistCount = childrenWaitlistCountByDate?.get(d.dateStr) ?? 0;
  if (childCount === 0 && waitlistCount === 0) return null;
  return (
    <div style={{ fontSize: '0.6rem', color: 'var(--ink-3)', fontWeight: 400 }}>
      {childCount > 0 && <span>{childCount}人</span>}
      {waitlistCount > 0 && (
        <span style={{ marginLeft: childCount > 0 ? '3px' : '0',
                       color: 'var(--ink-2)',
                       fontWeight: 600 }}
              title={`キャンセル待ち ${waitlistCount} 名`}>
          待{waitlistCount}
        </span>
      )}
    </div>
  );
})()}
```

#### 2.9.3 `src/lib/logic/generateShift.ts`

```ts
const dailyChildCount = new Map<string, number>();
for (const entry of scheduleEntries) {
  if (entry.attendance_status === 'absent') continue;
  if (entry.attendance_status === 'leave') continue;
  if (entry.attendance_status === 'waitlist') continue;  // Phase 64
  const count = dailyChildCount.get(entry.date) || 0;
  dailyChildCount.set(entry.date, count + 1);
}
```

理由: waitlist もカウントすると必要職員数が過剰見積もりになり、シフトが過剰生成される。

---

### 2.10 日次出力 `/output/daily`

#### `src/app/(app)/output/daily/page.tsx`

**個別エリア (custom area) の絵文字 lookup miss 修正** — テナント共通エリアだけでなく、児童ごとの `custom_pickup_areas` / `custom_dropoff_areas` も合流:

```ts
const allAreas = useMemo(() => {
  const all: AreaLabel[] = [...pickupAreas, ...dropoffAreas];
  for (const c of children) {
    if (Array.isArray(c.custom_pickup_areas)) all.push(...c.custom_pickup_areas);
    if (Array.isArray(c.custom_dropoff_areas)) all.push(...c.custom_dropoff_areas);
  }
  return all;
}, [pickupAreas, dropoffAreas, children]);
```

**新 useMemo `waitlistChildren`**:
```ts
const waitlistChildren = useMemo(() => {
  const childById = new Map(children.map((c) => [c.id, c]));
  const childOrderById = new Map(children.map((c, idx) => [c.id, idx]));
  const list = entries
    .filter((e) => e.attendance_status === 'waitlist')
    .map((e) => ({
      scheduleEntryId: e.id,
      childId: e.child_id,
      childName: childById.get(e.child_id)?.name ?? '(不明)',
      waitlistOrder: e.waitlist_order ?? null,
    }));
  list.sort((a, b) => {
    const oa = a.waitlistOrder ?? 999;
    const ob = b.waitlistOrder ?? 999;
    if (oa !== ob) return oa - ob;
    return (childOrderById.get(a.childId) ?? Number.MAX_SAFE_INTEGER) -
           (childOrderById.get(b.childId) ?? Number.MAX_SAFE_INTEGER);
  });
  return list;
}, [entries, children]);
```

**送迎タイムライン slots から waitlist 除外**:
```ts
for (const entry of entries) {
  if (entry.attendance_status === 'absent') continue;
  if (entry.attendance_status === 'leave') continue;
  if (entry.attendance_status === 'waitlist') continue;  // Phase 64
  if (!entry.pickup_time && !entry.dropoff_time) continue;
  // ...
}
```

**`activeChildCount` から waitlist 除外**:
```ts
const activeChildCount = useMemo(() => {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.attendance_status === 'absent') continue;
    if (e.attendance_status === 'leave') continue;
    if (e.attendance_status === 'waitlist') continue;  // Phase 64
    if (!e.pickup_time && !e.dropoff_time) continue;
    ids.add(e.child_id);
  }
  return ids.size;
}, [entries]);
```

**ヘッダに「キャンセル待ち N 名」併記**:
```jsx
<div className="text-base font-bold mt-1" style={{ color: 'var(--ink)' }}>
  出勤者 {onDuty.length}名・利用児童 {activeChildCount}名
  {waitlistChildren.length > 0 && (
    <>・<span style={{ color: 'var(--ink-2)' }}>キャンセル待ち {waitlistChildren.length}名</span></>
  )}
</div>
```

**「休憩」セクションを削除し、右カラム (本日の出勤の下) にキャンセル待ちセクションを縦並びで追加**:
```jsx
{/* 本日の出勤 (既存) */}
<section>...</section>

{/* Phase 64: シフトの直下にキャンセル待ちセクション (① ○○ / ② △△ を 1 行ずつ) */}
{waitlistChildren.length > 0 && (
  <section>
    <h3 className="text-base font-black pb-1 mb-2"
        style={{ color: 'var(--ink)', borderBottom: '2.5px solid var(--ink)' }}>
      キャンセル待ち
    </h3>
    <ul className="flex flex-col">
      {waitlistChildren.map((w) => {
        const orderMark = w.waitlistOrder ? '①②③④⑤⑥⑦⑧⑨⑩'.charAt(w.waitlistOrder - 1) : '－';
        return (
          <li key={w.scheduleEntryId}
              className="flex items-center gap-3 py-1.5"
              style={{ borderBottom: '1px dashed var(--rule)' }}>
            <span className="text-base font-black whitespace-nowrap"
                  style={{ color: 'var(--ink-2)', minWidth: '1.2em' }}>
              {orderMark}
            </span>
            <span className="text-base font-black whitespace-nowrap"
                  style={{ color: 'var(--ink)' }}>
              {w.childName}
            </span>
          </li>
        );
      })}
    </ul>
  </section>
)}

{/* 「休憩」セクションは削除済み */}
```

---

### 2.11 週次送迎 `/output/weekly-transport`

#### `src/app/(app)/output/weekly-transport/page.tsx`

```ts
setScheduleEntries(entries.filter((e) => {
  if (e.attendance_status === 'absent') return false;
  if (e.attendance_status === 'leave') return false;
  if (e.attendance_status === 'waitlist') return false;  // Phase 64
  if (!e.pickup_time && !e.dropoff_time) return false;
  return true;
}));
```

週次送迎は印刷専用で、ユーザー要望が「シンプルに除外」のみだったため、別表示は追加せずフィルタのみ。

---

### 2.12 デモバックエンド

#### 2.12.1 `src/lib/demo/demoBackend.ts`

```ts
const m = matchPath(pathname, '/api/schedule-entries/[id]/attendance');
if (m.matched && method === 'PATCH') {
  const id = m.params.id;
  const b = (body ?? {}) as { status?: string; waitlist_order?: number | null };
  const validStatuses = ['planned','present','absent','late','early_leave','leave','waitlist'];
  if (!b.status || !validStatuses.includes(b.status)) return bad('不正な出欠ステータスです');

  let nextOrder: number | null = null;
  if (b.status === 'waitlist' && b.waitlist_order != null) {
    const n = Number(b.waitlist_order);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return bad('キャンセル待ちの順番は 1〜10 で指定してください');
    }
    nextOrder = n;
  }

  let updated: ScheduleEntryRow | undefined;
  mutateDemoState((s) => {
    const e = s.schedule_entries.find((x) => x.id === id);
    if (!e) return;
    const old = e.attendance_status;
    e.attendance_status = b.status as ScheduleEntryRow['attendance_status'];
    e.waitlist_order = nextOrder;
    e.attendance_updated_at = nowIso();
    e.attendance_updated_by = DEMO_STAFF_ID_ME;
    // status 変更時のみ履歴を残す
    if (old !== e.attendance_status) {
      s.attendance_audit_logs.push({ ... });
    }
    updated = e;
  });
  return updated ? json({ entry: updated }) : json({ error: 'エントリが見つかりません' }, 404);
}
```

**bulk upsert 部分にも `waitlist_order` を追加**:
```ts
const row: ScheduleEntryRow = {
  // ...既存
  attendance_status: existing?.attendance_status ?? 'planned',
  attendance_updated_at: existing?.attendance_updated_at ?? null,
  attendance_updated_by: existing?.attendance_updated_by ?? null,
  waitlist_order: existing?.waitlist_order ?? null,  // Phase 64
  created_at: existing?.created_at ?? nowIso(),
};
```

#### 2.12.2 `src/lib/demo/seedData.ts`

```ts
schedule_entries.push({
  // ...既存
  attendance_status: 'planned',
  attendance_updated_at: null,
  attendance_updated_by: null,
  waitlist_order: null,  // Phase 64
  created_at: nowIso,
});
```

---

## 3. インポート整合性確認（追加コードなし）

### 3.1 PDF / Excel インポート (`src/app/api/schedule-entries/route.ts` POST)

確認結果: 追加コード変更不要。

理由:
- インポートで構築される `rows` は `attendance_status` カラムを **送らない**
- Supabase JS の `upsert` は **指定したカラムのみ更新**
- 既存 entry が `waitlist` 状態なら `attendance_status` と `waitlist_order` は保持される
- 新規 INSERT の場合は DB デフォルト値 `'planned'` になり、`waitlist_order` は NULL

### 3.2 diff モードの remove

```ts
.or('attendance_status.is.null,attendance_status.eq.planned');
```

`attendance_status != 'planned'` は保護されるため、**waitlist 児童は削除対象から外れる**。

---

## 4. 動作検証ポイント

### 4.1 Type check
```bash
npx tsc --noEmit
```
全 Phase で pass を確認。

### 4.2 Browser smoke test (`localhost:5000` または `:4000`)

| 画面 | 検証項目 |
|---|---|
| `/schedule` | 4 ボタン / 順番 5×2 ピッカー / セル「キャ待 ②」 / 注意書き / 日付色 (土青・日赤) / 利用数 + キャンセル待ちの 2 行 |
| `/transport` | 通常テーブルから waitlist 除外 / 下部集約 / 「利用に変える」確認モーダル / ヘッダ「🧒 利用 N人 ⏳ 待 N人」 |
| `/shift` | 各日ヘッダに「N人 待N」 / 過剰生成防止確認 |
| `/output/daily` | 右カラム本日の出勤の下にキャンセル待ちセクション (縦並び) / 休憩削除 / ヘッダ「キャンセル待ち N 名」 / 個別エリア絵文字表示 |

### 4.3 印刷検証

- 利用予定: A3 横、9pt、複数ページ可、各ページに日付ヘッダ繰り返し、利用数 + キャンセル待ち行が末尾に通常配置
- 日次出力: A3 縦、キャンセル待ちセクションは右カラム内に縦並び (横はみ出しなし)

---

## 5. コミット履歴

| コミット | 内容 |
|---|---|
| `b65002d` | fix(schedule): 利用予定の印刷を見やすく再構成 (A3横・複数ページ可) |
| `c8fd26d` | feat(phase64): キャンセル待ち (waitlist) 出欠ステータスを新規追加 |

両方とも `main` ブランチに push 済み。本番 Supabase には migration 0041 を手動適用済み（ユーザー実施）。

---

## 6. 既知の運用ルール（再現に必要）

### 6.1 マイグレーション適用フロー
- 開発端末でファイル作成 → Supabase ダッシュボードまたは CLI で本番 DB に手動適用
- CI で自動適用しない（ユーザー指示によりユーザー手動実行）

### 6.2 デプロイ
- `main` ブランチに push すると Vercel が自動デプロイ
- ユーザーが先にローカルホスト (`http://localhost:5000`) で動作確認 → OK 後に push

### 6.3 デモモード
- `DemoProvider.tsx` が `window.fetch` をモンキーパッチして `/api/*` を `demoBackend.ts` にルーティング
- 新エンドポイント・新フィールド追加時は **demoBackend と seedData 両方の更新が必要**
- 初回マウント時にパッチ前の fetch がリアル API に飛ぶことがある。ナビゲーション (DateStepper の ‹/›) で再 fetch を促すと正常化

### 6.4 ロール制御
- `viewer` ロール: 出欠変更可（自分以外も）。「利用に変える」ボタンは非表示
- `editor` / `admin`: 全操作可

### 6.5 監査ログ
- `attendance_audit_logs` に **status 変更時のみ** 自動記録
- 順番のみの変更では記録しない（運用上のノイズ削減）

---

## 7. 再現用チェックリスト

新規環境でこの実装を再現する場合の手順:

1. **マイグレーション**: `supabase/migrations/0041_attendance_waitlist.sql` を作成し、本番 DB に適用
2. **型**: `src/types/index.ts` の `AttendanceStatus` と `ScheduleEntryRow` を更新
3. **API**: 4 ルートの SELECT 句に `waitlist_order` を追加 + `attendance/route.ts` を 3 引数 RPC 呼び出しに修正
4. **デモ**: `demoBackend.ts` と `seedData.ts` を新ステータス対応に
5. **利用予定**: モーダル UI（4 ボタン + 5×2 ピッカー + 注意書き）+ ScheduleGrid のセル描画 + 最下部行 + 日付色バグ修正 + 印刷 CSS 書き直し
6. **送迎表**: フィルタ調整 + currentDayWaitlist memo + 集約行 + 確認モーダル + 「⏳ 待 N」ヘッダバッジ + generateTransport 入力フィルタ
7. **シフト表**: childrenCountByDate に waitlist 除外 + childrenWaitlistCountByDate 追加 + ShiftGrid prop + バッジ表示 + generateShift.ts 修正
8. **日次出力**: allAreas に custom area 合流 + waitlistChildren memo + slots フィルタ + activeChildCount 修正 + 右カラム新セクション + 休憩削除 + ヘッダ追記
9. **週次送迎**: フィルタに waitlist 追加
10. **進捗表**: `docs/progress.html` に Phase 64 セクション

各ステップで `npx tsc --noEmit` を通すこと。ローカル (`npm run dev`) で動作確認してから push。

---

## 8. 設計の要となる判断（再現時の判断材料）

| 判断 | 採用理由 |
|---|---|
| uniq 制約なし | 兄弟で同日 ① が 2 人ありえる |
| RPC 第3引数のデフォルト NULL | 既存の 2 引数呼び出しと後方互換性を保つ |
| order だけの変更で履歴記録しない | 監査ログのノイズを削減 |
| waitlist 切替時に元の order を維持 | UX: 待 → 出席 → 待に戻したとき番号を覚えてくれる |
| status 以外への切替で order を強制 NULL | DB CHECK 制約と整合 |
| 送迎表で waitlist は集約行 (ブロック化なし) | 印刷の縦圧迫を回避 |
| 日次出力で waitlist は右カラム配置 | シフトと同じ縦リズムで読みやすい |
| シフト表は数字バッジのみ (児童名は出さない) | シフト判定には人数だけで十分 |
| `childrenCountByDate` から waitlist 除外 | 必要職員数の過剰見積もり防止 |

以上。
