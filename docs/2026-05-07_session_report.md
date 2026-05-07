# セッション報告書 — 2026-05-07

> このドキュメントは「将来別の Claude / 開発者が同じ症状に出会ったとき、これだけ読めばゼロから再現・修正できる」ことを目標に書いている。実装の手順だけでなく、調査経緯・誤った仮説・落とし穴も明記する。

worktree: `claude/confident-fermi-12f0ef`
push 先: `origin/main` (https://github.com/deafzimukyoku-ic/deaf-ic-staffbase)
コミット範囲: `68cce57..33c4bec`

---

## 0. このセッションの全体俯瞰

### 0.1 スタート地点
ユーザーから「利用料金表の算定ロジックがおかしい。利用じゃないのに料金発生していたり、その逆があったりする」という報告で開始。最終的には 4 件の修正と 2 件の SQL 提示で着地。

### 0.2 修正一覧
| # | タイトル | コミット | 影響規模 |
|---|---|---|---|
| 1 | 出席判定の一元化 | `a64304e` | 8 ファイル + 1 新規 |
| 2 | shift_manager / manager 職員一覧が空問題（migration 154/155） | `79e5a9d` | 11 ファイル + 2 migration |
| 3 | Vercel ビルド失敗の追修正 | `8e91af5` | 1 ファイル |
| 4 | カテゴリモーダルの onChanged バグ | `33c4bec` | 10 ファイル |

### 0.3 通底する設計上の発見
- **CLAUDE.md §10「出席判定の一元化」** は文章ではうたっていたが、実装は各箇所コピペで微妙にズレていた → §1 で実装も一元化
- **`employees` テーブルの RLS は admin / self しか SELECT を許していない**（migration 010 から不変、migration 144 で manager 拡張するが 145 でロールバック済）→ §2 でこれを認識して RPC 化が必要だと判明
- **「親 ↔ 子コンポーネント間の変更通知」は手動で配線が必要**（React の自動同期はない）→ §4 でこの設計原則を踏襲し損ねていたバグを修正

---

## 1. 修正 1 — 出席判定の一元化（Phase 66-E）

### 1.1 症状
- 利用料金表（[BillingFull.tsx](components/shift/BillingFull.tsx)）で「利用していないのに料金発生」「逆に利用したのに料金発生していない」
- ユーザー証言（4/29 のスクリーンショット）:
  - 利用予定表で清水隼音・滝川希は 4/29 「—」（時間なし）
  - しかし料金表では 4/29「あおむしのお散歩制作 ¥100」にチェックが入っているように見える

### 1.2 調査手順（時系列）
1. **計算ロジックを読む**: [lib/logic/computeBilling.ts](lib/logic/computeBilling.ts) を Read。純関数。出席日数 × 50 円のおやつ + 月額固定の公文 + イベント参加合計。問題なさそう
2. **「出席日数」の決まり方を読む**: [BillingFull.tsx:184-194](components/shift/BillingFull.tsx:184) の旧ロジック:
   ```ts
   for (const e of entries) {
     if (e.attendance_status === 'absent') continue;
     if (e.attendance_status === 'leave') continue;
     if (e.attendance_status === 'waitlist') continue;
     if (!e.pickup_time && !e.dropoff_time) continue;
     // 出席カウント
   }
   ```
3. **ユーザーが SQL を 4 本実行して報告**:
   - SQL #1（料金表 ON 現実なし）: **山本美潤・中村日菜美** 4/29「あおむしのお散歩制作」が引っかかる
   - SQL #2（saved_days vs current_days）: 全児童完全一致 → 出席日数算定はバグなし
   - SQL #3-4（schedule_entries ゴミ）: 0 件
4. **真因はイベント参加チェックの保存値**:
   - [BillingFull.tsx:208-222](components/shift/BillingFull.tsx:208) の初期値ロジックを読む。**既存 `billing_summaries` がある月は participations を保存値から復元** し現在の schedule_entries は参照しない
   - 過去に時間が入っていた時期に保存 → 後で時間消去 → 保存値だけ残る = ゴースト
   - ユーザー証言の清水・滝川は SQL #1 にも引っかからなかった（保存値が false）。スクショ時の見え方は別事象（UI 上のローカルステート）と判明
5. **ユーザーから「出席判定どうなってた？時間が入っている（キャンセル待ちは除く）= 利用料金表のカウント判定にしては」と提案**
6. **影響範囲調査** で同じ判定が 8 箇所に散らばっており各々微妙にズレていることが判明
   - BillingFull / DailyOutputFull / WeeklyTransportFull: `status NOT IN (absent/leave/waitlist)` AND 時間あり
   - ShiftFull / generateShift: `status NOT IN (absent/leave/waitlist)` のみ（時間チェックなし）
   - TransportFull: `status NOT IN (absent/leave)` + waitlist は別扱いで保持
   - StaffChildOverlapView: 1 行で全除外
7. **CLAUDE.md §10 では「一元化」と書いてあるのに実装がコピペで散らばっていた**ので、ヘルパー関数化に踏み切った

### 1.3 根本原因（2 層）
- **L1: 各ファイルで判定ロジックがコピペされ、後から `waitlist` 追加時の修正が一部にしか入らなかった**（特に Phase 64 で waitlist 導入時に generateShift / ShiftFull は時間チェックなしのままだった）
- **L2: イベント参加チェックの初期値は新規月だけ schedule_entries から計算し、保存済月は固定**。これは正しい仕様（再印刷時に同じ値を出すための snapshot）だが「現状とのズレを目視できない」UX 問題が残っている（修正 1 では未対応、報告書 §7 残課題）

### 1.4 修正設計

新ロジック（CLAUDE.md §10 を以下に統一）:
```
出席 = (pickup_time OR dropoff_time が NOT NULL) AND (attendance_status !== 'waitlist')
```

理由:
- `absent` / `leave` を選ぶと UI で時刻が NULL に強制される（[ScheduleFull.tsx:376-385](components/shift/ScheduleFull.tsx:376) handleSave）→ `status` 明示除外は不要
- `waitlist` は present 昇格時に時刻を引き継ぐため時刻を保持する設計 → `status` で明示除外が必要
- レガシー `present` ステータスは時間ありなら出席扱いに自動該当
- 副次効果: 時間 NULL の `planned`（attendance status だけ作られた空セル）は非カウントになる → 「時間が入っている＝来所」という現場感覚と一致

### 1.5 実装

**新規ファイル**: [lib/logic/attendance.ts](lib/logic/attendance.ts)
```ts
export interface AttendanceCheckable {
  pickup_time: string | null;
  dropoff_time: string | null;
  attendance_status: string | null;
}

export function isAttended(e: AttendanceCheckable): boolean {
  if (e.attendance_status === 'waitlist') return false;
  return !!(e.pickup_time || e.dropoff_time);
}

export function isWaitlist(e: Pick<AttendanceCheckable, 'attendance_status'>): boolean {
  return e.attendance_status === 'waitlist';
}
```

**置換パターン（典型例 BillingFull.tsx）**:
```diff
+ import { isAttended } from '@/lib/logic/attendance';

  for (const e of entries) {
-   if (e.attendance_status === 'absent') continue;
-   if (e.attendance_status === 'leave') continue;
-   if (e.attendance_status === 'waitlist') continue;
-   if (!e.pickup_time && !e.dropoff_time) continue;
+   if (!isAttended(e)) continue;
    presentDaysByChildId.set(e.child_id, ...);
  }
```

**変更ファイル**: 7 箇所
- [components/shift/BillingFull.tsx](components/shift/BillingFull.tsx)
- [components/shift/DailyOutputFull.tsx](components/shift/DailyOutputFull.tsx)（出席日数 + activeChildCount 2 箇所）
- [components/shift/ShiftFull.tsx](components/shift/ShiftFull.tsx)（childrenCountByDate）
- [components/shift/WeeklyTransportFull.tsx](components/shift/WeeklyTransportFull.tsx)
- [components/shift/TransportFull.tsx](components/shift/TransportFull.tsx)（特例: `isAttended ∪ isWaitlist` で保持。waitlist セクション表示用）
- [components/shift/StaffChildOverlapView.tsx](components/shift/StaffChildOverlapView.tsx)
- [lib/logic/generateShift.ts](lib/logic/generateShift.ts)（dailyChildCount）

**ドキュメント反映**:
- [CLAUDE.md](CLAUDE.md) §10 の「deaf-ic 出席判定」を `isAttended()` ベースに書き換え（旧版は ` NOT IN (absent/leave/waitlist)` 表記）
- [docs/reference-map.md](docs/reference-map.md) §14a 追加: 利用箇所一覧 + 設計判断
- [docs/progress.html](docs/progress.html) Phase 66-E 追加

### 1.6 検証
- ローカル `npm run build` 成功
- ユーザー目視確認待ち（実 UI での挙動チェックは未報告）

### 1.7 注意点 / 落とし穴
- **TransportFull の `setScheduleEntries` だけ特例**: 送迎表は「キャンセル待ちセクション」を別箇所に表示するため、scheduleEntries 自体は `isAttended || isWaitlist` の両方を持たせる。後段の絞り込みは `isAttended()` / `isWaitlist()` を場面に応じて使い分け
- **既存サマリと現状の乖離 UI 警告は未実装**: 修正 1 はロジック統一のみ。「料金表の保存値と現状 schedule_entries が乖離している」を ⚠️ 表示する案（前回提案 a/c）は今回見送り
- **ゴーストデータの実害**: 山本美潤・中村日菜美 4/29「あおむしのお散歩制作 ¥100」の 2 件は別途 SQL クリーンアップが必要（§5.2 参照）

---

## 2. 修正 2 — shift_manager / manager 職員一覧が空問題（Phase 70 fix, migration 154 + 155）

### 2.1 症状
- ユーザーが `shift-3baea499@deaf-ic-nagoya.org`（パズル事業所のシフト統括 = `shift_manager` ロール）でログイン
- 送迎表を開くと「自分 1 人だけ」しか表示されない
- 同症状: シフト表 / 職員管理 / 日次出力 / 業務日報 / 同席日数

### 2.2 調査手順（時系列）

**ステップ A: ロール定義の確認**
- migration 140 (`140_shift_manager_role.sql`) を Read
- shift_manager に許可されているテーブル: children, schedule_entries, shift_assignments, transport_assignments, facility_shift_settings, events, billing_summaries, billing_event_participations
- shift_requests: SELECT only / shift_change_requests: manager と同等
- **employees テーブルへの言及なし** ← 怪しい

**ステップ B: employees の RLS を確認**
- [supabase/migrations/010_rls.sql:44-65](supabase/migrations/010_rls.sql:44) を Read
- `"employee can read self"` (auth_user_id 一致のみ)
- `"admin can read tenant employees"` (admin/super_admin のみ)
- **manager / shift_manager 用ポリシーは存在しない**

**ステップ C: manager 拡張の試行記録を確認**
- [supabase/migrations/144_manager_can_read_subordinates.sql](supabase/migrations/144_manager_can_read_subordinates.sql): manager / shift_manager 用 SELECT ポリシー追加
- [supabase/migrations/145_rollback_144.sql](supabase/migrations/145_rollback_144.sql): **「全員ログアウト」現象発生で 144 をロールバック**
- [supabase/migrations/146_get_my_subordinates_rpc.sql](supabase/migrations/146_get_my_subordinates_rpc.sql): RLS をいじらず SECURITY DEFINER RPC で必要な部下情報を返す方式に変更（migration 145 ロールバック後の代替実装）

**ステップ D: 送迎表のクエリを確認**
- [components/shift/TransportFull.tsx:233-249](components/shift/TransportFull.tsx:233) で `fetchFacilityMemberIds(supabase, facilityId)` 呼び出し
- [lib/multi-facility.ts:50-62](lib/multi-facility.ts:50) を Read: `supabase.from('employees').select('id').eq('facility_id', facilityId)` を直接 SELECT
- **これが employees の RLS で manager / shift_manager は自分 1 件しか返さない**

**ステップ E（最初の MVP 失敗）: ID リスト RPC 化（migration 154）**
- `fetchFacilityMemberIds` を SECURITY DEFINER RPC `get_facility_member_ids` 化
- TypeScript 側も RPC 経由に変更
- ユーザーに「シフト統括で職員管理を開いてみて」と依頼
- **ユーザー報告: まだ 1 名しか出ない**

**ステップ F: 第 2 層の問題に気付く**
- [StaffSettingsFull.tsx:282-291](components/shift/StaffSettingsFull.tsx:282) を Read
  ```ts
  const memberIds = await fetchFacilityMemberIds(...);   // ID は取れる
  supabase.from('employees').select(...).in('id', memberIds);  // ← ここで RLS が再発動
  ```
- ID リストだけ RLS バイパスしても、続く `from(...).in()` で再び弾かれる
- **行データ全体を返す RPC** が必要

**ステップ G: 行データ RPC 化（migration 155）**
- `get_facility_members(p_facility_id uuid)` を新設し戻り値カラムを 22 個指定
- 8 ファイル分のクエリを RPC 経由に置換
- 並行して**重要な発見**: MCP の `apply_migration` は `companiers-searcher` という別プロジェクトに繋がっており、deaf-ic 本体には反映されていなかった
- ユーザーに Supabase SQL Editor で手動適用してもらう

**ステップ H: ユーザー確認**
- 「見れるようになった！OK です！」

### 2.3 根本原因（3 層）

| 層 | 問題 |
|---|---|
| L1 | `employees` の RLS が admin / self しか許していない |
| L2 | `fetchFacilityMemberIds` 単体を RPC 化しても、`from('employees').in('id', ids)` が後段にあるため RLS で再度弾かれる |
| L3 | MCP `apply_migration` が別プロジェクトに繋がっていて、`{success: true}` が返っても本体 DB に反映されない |

### 2.4 修正設計

**migration 154** (`get_facility_member_ids`): id 配列のみ返す軽量版。assignments の結合キー判定など ID だけで足りる用途専用に**残置**

**migration 155** (`get_facility_members`): 行データ全体を返す本命

戻り値カラム（住所・電話・birth_date・銀行・保険番号は**含めない** = 機密情報漏洩防止）:
```
id, tenant_id, facility_id, employee_number, last_name, first_name,
email, role, status, employment_type, default_start_time, default_end_time,
pickup_transport_areas, dropoff_transport_areas, qualifications,
shift_qualifications, is_qualified, is_driver, is_attendant,
shift_display_order, join_date, employee_position
```

認可ロジック:
- 認証なし / 自テナントなし → 空
- `role NOT IN (admin/manager/shift_manager)` → 空
- facility が同テナント外 → 空
- manager / shift_manager かつ facility が `get_my_managed_facility_ids()` 範囲外 → 空
- それ以外 → 主所属 + 兼任 (`employee_facilities`) を union して返す

`position` は PostgreSQL の予約語のため戻り値カラム名を `employee_position` にする（migration 146 と同じ手法）。

### 2.5 実装

**migration 155** (全文。`get_facility_members(p_facility_id uuid)`):
```sql
create or replace function public.get_facility_members(p_facility_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  facility_id uuid,
  employee_number text,
  last_name text,
  first_name text,
  email text,
  role text,
  status text,
  employment_type text,
  default_start_time time,
  default_end_time time,
  pickup_transport_areas text[],
  dropoff_transport_areas text[],
  qualifications text[],
  shift_qualifications text[],
  is_qualified boolean,
  is_driver boolean,
  is_attendant boolean,
  shift_display_order integer,
  join_date date,
  employee_position text
) as $$
declare
  v_role text;
  v_tenant uuid;
  v_facility_tenant uuid;
begin
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e where e.auth_user_id = auth.uid() limit 1;

  if v_tenant is null then return; end if;
  if v_role not in ('admin', 'manager', 'shift_manager') then return; end if;

  select f.tenant_id into v_facility_tenant
  from public.facilities f where f.id = p_facility_id limit 1;

  if v_facility_tenant is null or v_facility_tenant <> v_tenant then return; end if;

  if v_role in ('manager', 'shift_manager') then
    if not exists (
      select 1 from public.get_my_managed_facility_ids() m where m = p_facility_id
    ) then
      return;
    end if;
  end if;

  return query
  select distinct on (e.id)
    e.id, e.tenant_id, e.facility_id,
    e.employee_number, e.last_name, e.first_name, e.email,
    e.role, e.status, e.employment_type,
    e.default_start_time, e.default_end_time,
    e.pickup_transport_areas, e.dropoff_transport_areas,
    e.qualifications, e.shift_qualifications,
    e.is_qualified, e.is_driver, e.is_attendant,
    e.shift_display_order, e.join_date,
    e.position as employee_position
  from public.employees e
  left join public.employee_facilities ef on ef.employee_id = e.id
  where e.tenant_id = v_tenant
    and (e.facility_id = p_facility_id or ef.facility_id = p_facility_id);
end;
$$ language plpgsql security definer set search_path = public stable;

grant execute on function public.get_facility_members(uuid) to authenticated;
```

**TypeScript ヘルパー** ([lib/multi-facility.ts](lib/multi-facility.ts)):
```ts
export interface FacilityMemberRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
  employee_number: string | null;
  last_name: string;
  first_name: string;
  email: string | null;
  role: string;
  status: string;
  employment_type: string | null;
  default_start_time: string | null;
  default_end_time: string | null;
  pickup_transport_areas: string[] | null;
  dropoff_transport_areas: string[] | null;
  qualifications: string[] | null;
  shift_qualifications: string[] | null;
  is_qualified: boolean | null;
  is_driver: boolean | null;
  is_attendant: boolean | null;
  shift_display_order: number | null;
  join_date: string | null;
  employee_position: string | null;
}

export async function fetchFacilityMembers(
  supabase: SupabaseClient,
  facilityId: string
): Promise<FacilityMemberRow[]> {
  const { data, error } = await supabase.rpc('get_facility_members', {
    p_facility_id: facilityId,
  });
  if (error) {
    console.error('[fetchFacilityMembers] RPC error', error);
    return [];
  }
  return (data ?? []) as FacilityMemberRow[];
}
```

**置換パターン（典型例 ShiftFull.tsx）**:
```diff
- import { fetchFacilityMemberIds } from '@/lib/multi-facility';
+ import { fetchFacilityMembers } from '@/lib/multi-facility';

- const memberIds = await fetchFacilityMemberIds(supabase, facilityId);
- const { data: emps, error } = memberIds.length === 0
-   ? { data: [], error: null }
-   : await supabase
-       .from('employees')
-       .select('id, tenant_id, ...')
-       .in('id', memberIds)
-       .eq('status', 'active')
-       .order('shift_display_order', ...)
-       .order('last_name', ...);
+ const allMembers = await fetchFacilityMembers(supabase, facilityId);
+ const emps = allMembers
+   .filter((m) => m.status === 'active')
+   .sort((a, b) => {
+     const ao = a.shift_display_order ?? Number.MAX_SAFE_INTEGER;
+     const bo = b.shift_display_order ?? Number.MAX_SAFE_INTEGER;
+     if (ao !== bo) return ao - bo;
+     return (a.last_name ?? '').localeCompare(b.last_name ?? '', 'ja');
+   });
```

**8 ファイル変更**: StaffSettingsFull, TransportFull, ShiftFull, WeeklyTransportFull, DailyOutputFull, DailyReportFull, StaffChildOverlapView, AdminRequestsView

### 2.6 検証
- 本番 (Vercel) ビルド成功
- ユーザー UI 動作確認: 「見れるようになった」

### 2.7 注意点 / 落とし穴

**A. MCP `apply_migration` の戻り値を信用しない**

```
list_projects → companiers-searcher (1 件) しか返らない
apply_migration → {success: true}
execute_sql で `select count(*) from public.employees` → ERROR: relation does not exist
```

つまり MCP は別プロジェクトに繋がっていて、deaf-ic 本体には何も反映されていなかった。**`apply_migration` 後は `execute_sql` で実在テーブルを 1 つ叩いて疎通確認すべき**。それでも本番反映は別ステップ（手動 SQL Editor 実行）になる。

**B. RPC 戻り値カラム順序とテーブル列の型一致**

`returns table` は左から順に位置で一致させる（PostgreSQL 仕様）。テーブル列の型と RPC 戻り値型がずれると `structure of query does not match function result type` エラー。今回は実 employees のカラム型が `text` であることを前提にしている。

**C. `position` は予約語**

employees テーブルに `position` というカラムがあるが、`returns table (..., position text)` だと予約語衝突。`employee_position` に名前変更（migration 146 と同じ手法）。

**D. `distinct on (e.id)` の必要性**

主所属 + employee_facilities LEFT JOIN で union するとき、兼任が複数 facility にある職員は重複行が出る。`distinct on (e.id)` で 1 行に絞る。

**E. ID 配列だけ返す軽量版（migration 154）も残しておく理由**

assignments の結合キー判定など「ID だけで足りる」用途では残置。重い行データを毎回引かない最適化。ただし `fetchFacilityMemberIds` を呼んだ後 `from('employees').in()` するパターンは絶対書かないこと（同じバグ再発）。

**F. 教訓: ローカル `npm run build` は最後まで待つ**

Next.js 16 は `Compiled successfully` の後に TypeScript チェック → static page 生成と続く。`tail -30` だけ見ると Compiled しか見えず Type error を見逃す。Monitor でも `Generating static pages` まで確認すること。

---

## 3. 修正 3 — Vercel ビルド失敗の追修正（`memberIds` 参照漏れ）

### 3.1 症状
Vercel デプロイログで:
```
./components/shift/ShiftFull.tsx:218:38
Type error: Cannot find name 'memberIds'.
> 218 |       const { data: crossAssigns } = memberIds.length === 0
```

### 3.2 原因
修正 2 で `fetchFacilityMemberIds` を `fetchFacilityMembers` に置き換えた際、`emps` 取得の前後で `memberIds` 変数を消したが、後段の「兼任職員の他施設での勤務 (`crossAssigns`) 絞り込み」（Phase 130 由来）で `memberIds.length === 0 ? ... : ...in('employee_id', memberIds)` がそのまま残っていた。

### 3.3 修正
[components/shift/ShiftFull.tsx:218](components/shift/ShiftFull.tsx:218) で 1 行追加:
```diff
+ const memberIds = emps.map((e) => e.id);
  const { data: crossAssigns } = memberIds.length === 0
```

### 3.4 教訓
- ローカルビルドで `Compiled successfully` だけ見て push したのが原因
- Next.js 16 ビルドは 3 段階（Compile → Type check → Static page）。最後まで待つ
- Monitor で `Generating static pages using N workers` のログまで確認するルール化（このセッション後半は実践済）

---

## 4. 修正 4 — カテゴリモーダルの onChanged バグ

### 4.1 症状
業務マニュアル / 遵守事項 / 研修 / お知らせ で「カテゴリ管理」モーダルから新規カテゴリを作成しても、親画面のカテゴリ列・フィルタに反映されず、ページリロードしないと表示されない。

### 4.2 調査手順
1. [components/admin/CategoryManager.tsx](components/admin/CategoryManager.tsx) を Read。`handleCreate` は POST → `await load()` で内部 state を再取得。**モーダル内のリストは即更新される**
2. [components/admin/CategoryManagerModal.tsx](components/admin/CategoryManagerModal.tsx) を Read。Dialog で `<CategoryManager type={type} />` をラップしているだけ。**親画面への通知 prop が一切ない**
3. 親画面（例 [app/(admin)/admin/compliance/page.tsx:269](app/(admin)/admin/compliance/page.tsx:269)）を Read:
   ```tsx
   <CategoryManagerModal type="compliance" />
   ```
   親側の `categories` state は `loadDocs` で初回のみ fetch。モーダル変更を知る術がない
4. **正解パターンが既にあった**: [CategoryImportModal](components/admin/CategoryImportModal.tsx) は `onImported={load}` というコールバックで親に通知している。**CategoryManagerModal だけ非対称（バグ）**

### 4.3 根本原因
`CategoryManagerModal` の責務は「Dialog 表示」+「親への変更通知」だが、後者が抜けていた。React は親子間の自動同期をしないので、明示的な通知 prop が必要。

### 4.4 修正設計

3 層変更:
1. `CategoryManager` に `onChanged?: () => void | Promise<void>` プロパティ追加。`handleCreate` / `handleUpdate` / `handleDelete` / `handleDragEnd` 成功後に `onChanged?.()` 発火
2. `CategoryManagerModal` にも同 prop を追加して `CategoryManager` に渡す
3. 8 つの親画面で **「カテゴリだけ再 fetch」する軽量関数** を追加し `onChanged` で渡す

「カテゴリだけ再 fetch」にしたのは、ページ全体の `loadDocs` を呼ぶと documents / facilities / positions まで全部再取得するため。カテゴリ追加の頻度を考えると無駄。

### 4.5 実装

**コンポーネント変更**:
```diff
// CategoryManager.tsx
  interface Props {
    type: CategoryType;
+   onChanged?: () => void | Promise<void>;
  }

  async function handleCreate() {
    // ... (POST 成功後)
    await load();
+   onChanged?.();
  }
  // handleUpdate / handleDelete / handleDragEnd でも同様に発火
```

```diff
// CategoryManagerModal.tsx
  interface Props {
    type: CategoryType;
    triggerLabel?: string;
+   onChanged?: () => void | Promise<void>;
  }

- export function CategoryManagerModal({ type, triggerLabel = '📁 カテゴリ管理' }: Props) {
+ export function CategoryManagerModal({ type, triggerLabel = '📁 カテゴリ管理', onChanged }: Props) {
    // ...
-   <CategoryManager type={type} />
+   <CategoryManager type={type} onChanged={onChanged} />
```

**親画面パターン（8 ファイル全て同じ形）**:
```diff
- import { useState, useEffect } from 'react';
+ import { useState, useEffect, useCallback } from 'react';

  // (state 宣言の近くに追加)
+ /* カテゴリだけ再 fetch（CategoryManagerModal でカテゴリ追加・編集・削除されたとき用） */
+ const reloadCategories = useCallback(async () => {
+   const catRes = await fetch('/api/categories?type=announcement');  // ← 各画面で type を変える
+   if (catRes.ok) setCategories(await catRes.json());
+ }, []);

  // JSX
- <CategoryManagerModal type="announcement" />
+ <CategoryManagerModal type="announcement" onChanged={reloadCategories} />
```

**8 ファイルの type マッピング**:
| ファイル | type |
|---|---|
| `app/(admin)/admin/compliance/page.tsx` | `compliance` |
| `app/(admin)/admin/trainings/page.tsx` | `training` |
| `app/(admin)/admin/announcements/page.tsx` | `announcement` |
| `app/(admin)/admin/manuals/page.tsx` | `manual` |
| `app/(manager)/mgr/compliance/page.tsx` | `compliance` |
| `app/(manager)/mgr/trainings/page.tsx` | `training` |
| `app/(manager)/mgr/announcements/page.tsx` | `announcement` |
| `app/(manager)/mgr/manuals/page.tsx` | `manual` |

### 4.6 検証
- ローカル `npm run build` 完全成功（103/103 static pages 生成）

### 4.7 注意点 / 落とし穴
- **`useCallback` の依存配列は `[]` で OK**（state setter は React がメモ化を保証）
- **mgr/compliance のように `loadDocs(tid: string)` が引数を取るパターン** では `onChanged={loadDocs}` 直渡しはできない。`reloadCategories` 専用関数を作る方が一貫性がある
- **CategoryImportModal の `onImported` も同じパターン**。今回 CategoryManager 内で `onImported={async () => { await load(); onChanged?.(); }}` に修正済（取り込み経由でも親に通知）

---

## 5. 提示した SQL（再利用可能）

### 5.1 シフト統括アカウント削除（CTE 1 ステートメント版）

**前提**: `shift_manager` ロール（migration 140）を廃止 or 個別に削除する場合。`employees.auth_user_id` は `references auth.users(id)` で `on delete` 指定なしのため、employees → auth.users の順で消す必要がある。最初の試行で「temp table が SQL Editor 実行毎にセッション切れる」問題に遭遇したので CTE 1 文に統一。

```sql
-- 確認用
select e.id, e.email, e.facility_id, f.name as facility_name,
       e.last_name, e.first_name, e.created_at, e.auth_user_id
from public.employees e
left join public.facilities f on f.id = e.facility_id
where e.role = 'shift_manager'
order by e.created_at;

-- 削除（service_role で実行）
with deleted_employees as (
  delete from public.employees
  where role = 'shift_manager'
  returning auth_user_id
)
delete from auth.users
where id in (
  select auth_user_id from deleted_employees where auth_user_id is not null
);
```

実行先: Supabase SQL Editor（service_role）

ロール CHECK 制約 (`employees_role_check` に `shift_manager` 含む) は migration 140 でついたまま残る。再発行しないなら別 migration で外しても良い（行が無ければ実害ゼロ）。

### 5.2 利用料金表ゴーストデータ クリーンアップ

**前提**: 修正 1 の調査で発見したゴースト 2 件（山本美潤・中村日菜美の 4/29「あおむしのお散歩制作 ¥100」）の処理。

```sql
-- 確認: 料金表 participated=true だが現実に schedule_entries が無いケース
with target as (
  select bs.child_id, c.name, bep.event_id, e.name as event_name, e.date,
         bep.participated as billing_says_participated
  from billing_event_participations bep
  join billing_summaries bs on bs.id = bep.billing_summary_id
  join events e on e.id = bep.event_id
  join children c on c.id = bs.child_id
  where bs.year = 2026 and bs.month = 4 and bep.participated = true
)
select t.*, se.pickup_time, se.dropoff_time, se.attendance_status
from target t
left join schedule_entries se on se.child_id = t.child_id and se.date = t.date
where se.id is null
   or (se.pickup_time is null and se.dropoff_time is null)
   or se.attendance_status in ('absent','leave','waitlist');

-- 修正
update billing_event_participations bep
set participated = false, amount = 0
from billing_summaries bs, events e
where bep.billing_summary_id = bs.id
  and bep.event_id = e.id
  and bs.year = 2026 and bs.month = 4
  and e.date = '2026-04-29'
  and bs.child_id in (
    '451ea7b0-2500-4b07-8c85-774caba0d04c',  -- 山本美潤
    'ee26bdc8-7b92-4fbb-a513-cf93b5985381'   -- 中村日菜美
  )
  and bep.participated = true;

-- summary 側 event_total / total_amount を再計算
update billing_summaries bs
set event_total = sub.total,
    total_amount = coalesce(bs.copay_amount, 0) + bs.snack_fee + bs.kumon_fee + sub.total
from (
  select billing_summary_id, coalesce(sum(amount), 0) as total
  from billing_event_participations
  group by billing_summary_id
) sub
where bs.id = sub.billing_summary_id
  and bs.year = 2026 and bs.month = 4
  and bs.child_id in (
    '451ea7b0-2500-4b07-8c85-774caba0d04c',
    'ee26bdc8-7b92-4fbb-a513-cf93b5985381'
  );
```

### 5.3 出席日数のサニティチェック（任意月）

```sql
-- 任意の YYYY/MM に置き換え
select bs.child_id, c.name, bs.attendance_days as saved_days,
  (
    select count(*) from schedule_entries se
    where se.child_id = bs.child_id
      and se.date >= make_date(bs.year, bs.month, 1)
      and se.date <  (make_date(bs.year, bs.month, 1) + interval '1 month')
      and (se.pickup_time is not null or se.dropoff_time is not null)
      and se.attendance_status not in ('absent','leave','waitlist')
  ) as current_days
from billing_summaries bs
join children c on c.id = bs.child_id
where bs.year = 2026 and bs.month = 4
order by abs(bs.attendance_days - (
    select count(*) from schedule_entries se
    where se.child_id = bs.child_id
      and se.date >= make_date(bs.year, bs.month, 1)
      and se.date <  (make_date(bs.year, bs.month, 1) + interval '1 month')
      and (se.pickup_time is not null or se.dropoff_time is not null)
      and se.attendance_status not in ('absent','leave','waitlist')
)) desc;
```

### 5.4 schedule_entries の怪しい行検出

```sql
select c.name, se.date, se.pickup_time, se.dropoff_time, se.attendance_status, se.created_at
from schedule_entries se
join children c on c.id = se.child_id
where se.date >= '2026-04-01' and se.date < '2026-05-01'
  and (
    (se.pickup_time is null and se.dropoff_time is null and se.attendance_status = 'planned')
    or se.attendance_status = 'present'  -- レガシー
  )
order by c.name, se.date;
```

---

## 6. 関連知識（既存設計の押さえ）

### 6.1 関連 migration の系譜（時系列）

| 番号 | 内容 | 重要性（このセッションでの参照度） |
|---|---|---|
| 010 | employees の RLS 初期定義（admin / self のみ）| ★★★ 修正 2 の根本 |
| 100 | `schedule_entries` 元定義（attendance_status 列）| ★★ 修正 1 |
| 105 | `attendance_status` CHECK に `leave` 追加 | ★ |
| 124 | `attendance_status` CHECK に `waitlist` 追加 + `waitlist_order` + RPC 第3引数 | ★★ 修正 1 |
| 126〜128 | 利用料金表 一式（children billing fields / events / billing_summaries / billing_event_participations）| ★★ 修正 1 |
| 130 | `employee_facilities` テーブル + `get_my_facility_ids` / `get_my_managed_facility_ids` ヘルパー | ★★★ 修正 2 |
| 140 | `shift_manager` ロール導入 | ★★★ 修正 2 |
| 144 | manager / shift_manager 用 employees SELECT ポリシー追加 | ★★★ 修正 2（教訓） |
| 145 | 144 の即ロールバック（全員ログアウト発生） | ★★★ 修正 2（教訓） |
| 146 | `get_my_subordinates` SECURITY DEFINER RPC（144 の代替） | ★★★ 修正 2（参考設計） |
| 154 | **`get_facility_member_ids` RPC（id 配列のみ）** | ★★★ 修正 2 |
| 155 | **`get_facility_members` RPC（行データ全体）** | ★★★ 修正 2（本命） |

### 6.2 `categories` テーブル設計

- `type` enum: `compliance` / `training` / `announcement` / `manual`
- 各コンテンツテーブル (`compliance_documents`, `trainings`, `announcements`, `manuals`) は `category_id` で紐付け
- カテゴリ管理 UI は `CategoryManager` (本体) + `CategoryManagerModal` (Dialog ラッパ) + `CategoryImportModal` (他 type からの取り込み)
- API: `/api/categories?type=...` (GET) / `/api/categories` (POST/PATCH) / `/api/categories/[id]` (PATCH/DELETE) / `/api/categories/bulk` (一括)

### 6.3 RLS バイパス用 SECURITY DEFINER RPC のパターン

deaf-ic では migration 144 のロールバック以降、**RLS をいじらず SECURITY DEFINER RPC で必要最小限のフィールドだけ返す**設計に統一。
- migration 146: `get_my_subordinates()` — manager / shift_manager の管轄部下
- migration 154: `get_facility_member_ids(facility_id)` — facility 所属職員の ID 配列
- migration 155: `get_facility_members(facility_id)` — facility 所属職員の運用属性（行データ）

設計テンプレート（再利用時の雛形）:
```sql
create or replace function public.get_xxx(p_arg uuid)
returns table (...) as $$
declare
  v_role text; v_tenant uuid;
begin
  -- 1. 認証 + 自テナント
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e where e.auth_user_id = auth.uid() limit 1;
  if v_tenant is null then return; end if;

  -- 2. 認可（ロールチェック）
  if v_role not in ('admin', 'manager', 'shift_manager') then return; end if;

  -- 3. リソースが自テナントか
  -- (省略)

  -- 4. manager / shift_manager のスコープチェック
  if v_role in ('manager', 'shift_manager') then
    if not exists (...) then return; end if;
  end if;

  -- 5. データ返却
  return query select ...;
end;
$$ language plpgsql security definer set search_path = public stable;

grant execute on function public.get_xxx(uuid) to authenticated;
```

`set search_path = public` 重要: SECURITY DEFINER 関数で search_path を固定しないと、悪意あるユーザーが temp スキーマで関数を上書きしてくる攻撃を受けうる（PostgreSQL の有名な落とし穴）。

### 6.4 employees の RLS 改造案が失敗する理由（経験則）

migration 144 で「`OR` 節を増やす ポリシー」を追加すると「全員ログアウト」現象が発生した。原因は完全には突き止められていないが、推測:
- `OR` 節中で `EXISTS (SELECT 1 FROM employee_facilities WHERE ...)` を呼ぶと employees テーブルへの再帰参照が発生
- 認証 middleware の `select * from employees where auth_user_id = auth.uid()` がタイムアウト or 評価失敗 → 認証失敗扱い → セッション破棄

教訓: **employees の RLS は触らない**。代わりに SECURITY DEFINER RPC で必要なものを切り出す。

---

## 7. 残課題 / 次のセッションで対応すべきこと

| # | 項目 | 重要度 | 補足 |
|---|---|---|---|
| 1 | **migration 154/155 を本番 (Vercel デプロイ先) Supabase に適用済か確認** | ★★★ | dev 環境 (= localhost で確認した DB) のみ確認済。本番が別 Supabase なら shift_manager で同症状再発 |
| 2 | ゴースト 2 件 (山本・中村 4/29 イベント) のクリーンアップ SQL 実行 | ★★ | 報告書 §5.2 の SQL を Supabase SQL Editor で実行 |
| 3 | シフト統括アカウントの削除（不要なら） | ★ | §5.1 の SQL 提示済 |
| 4 | 出席判定の「料金表で過去保存と現在の差分を視覚警告」UI | ★ | 前回案 a。料金表セルで保存済 participated と現状 schedule_entries が乖離している場合 ⚠️ 表示 |
| 5 | `present` ステータスのレガシー削除 | ★ | enum に残置。実害なし |
| 6 | shift_manager ロール（migration 140）の CHECK 制約撤回 | ★ | 再発行しない方針なら別 migration で外す |
| 7 | **職員ステーションの使い方マニュアル制作**（次のユーザー要望）| — | PPTX / GIF / PDF 候補。要件確認中 |

---

## 8. 学んだこと / 運用への反映

### 8.1 MCP `apply_migration` の戻り値を信用しない
- 戻り値 `{success: true}` は単に SQL が文法エラーを起こさず実行されたことを示すだけ
- プロジェクト ID が想定外の DB を指している可能性がある（今回は `companiers-searcher` という別プロジェクト）
- **対策**: `apply_migration` 後に `execute_sql` で実在テーブルを 1 つ叩いて疎通確認 → ユーザーに「Supabase SQL Editor で実行する SQL」を渡して手動適用させる

### 8.2 `npm run build` は 3 段階全部待つ
- Next.js 16 のビルド: Compile → TypeScript → Static page (N/N)
- `Compiled successfully` の後に `Failed to type check` が出る
- `tail -30` だけでは見逃す
- **対策**: Monitor で `Generating static pages using N workers` のログまで見る or exit code を確認

### 8.3 RLS バイパス用 RPC は「行データ全体を返す」
- ID だけ返しても呼び出し側で `from(...).in('id', ids)` すると RLS が再発動する
- 必要なカラム全部を SECURITY DEFINER で返す
- **対策**: `get_facility_member_ids` を残しつつ実用は `get_facility_members` に統一

### 8.4 モーダル / 子コンポーネントには変更通知 prop を持たせる
- `CategoryImportModal` は `onImported` を持っていたが `CategoryManagerModal` にはなかった、という非対称が今回のバグの根
- 同種コンポーネントの差分は要レビュー

### 8.5 一元化文書と実装の乖離
- CLAUDE.md §10 に「出席判定（一元化）」と書いてあったが、実装はコピペだった
- ドキュメント明文化と実装が同期しているか定期点検が必要
- **対策**: 「ドキュメントに書いた実装ガイドライン」は **必ずヘルパー関数化して import するパターン** に強制する（手書きコピペ禁止）

---

## 9. 触ったファイル一覧

### 新設
- `lib/logic/attendance.ts`
- `supabase/migrations/154_get_facility_member_ids_rpc.sql`
- `supabase/migrations/155_get_facility_members_rpc.sql`
- `docs/2026-05-07_session_report.md`（本ファイル）

### 変更（コード）
- `lib/multi-facility.ts` (`fetchFacilityMembers` + `FacilityMemberRow` 追加)
- `lib/logic/generateShift.ts`
- `components/admin/CategoryManager.tsx`
- `components/admin/CategoryManagerModal.tsx`
- `components/shift/BillingFull.tsx`
- `components/shift/DailyOutputFull.tsx`
- `components/shift/DailyReportFull.tsx`
- `components/shift/ShiftFull.tsx` (修正 2 + 修正 3)
- `components/shift/StaffChildOverlapView.tsx`
- `components/shift/StaffSettingsFull.tsx`
- `components/shift/TransportFull.tsx`
- `components/shift/WeeklyTransportFull.tsx`
- `components/shift/AdminRequestsView.tsx`
- `app/(admin)/admin/compliance/page.tsx`
- `app/(admin)/admin/trainings/page.tsx`
- `app/(admin)/admin/announcements/page.tsx`
- `app/(admin)/admin/manuals/page.tsx`
- `app/(manager)/mgr/compliance/page.tsx`
- `app/(manager)/mgr/trainings/page.tsx`
- `app/(manager)/mgr/announcements/page.tsx`
- `app/(manager)/mgr/manuals/page.tsx`

### 変更（ドキュメント）
- `CLAUDE.md` (§10 出席判定一元化を `isAttended` ベースに改訂)
- `docs/reference-map.md` (§14a, §14b 追加)
- `docs/progress.html` (Phase 66-E, Phase 70 fix 追加)

### コミット履歴
- `a64304e` — 出席判定の一元化 (lib/logic/attendance.ts) — 料金表ゴーストデータ対策
- `79e5a9d` — shift_manager / manager で職員一覧が空問題の修正 (migration 154/155)
- `8e91af5` — ShiftFull: memberIds の参照漏れ修正 (Vercel TypeScript エラー)
- `33c4bec` — カテゴリ作成後の即時反映 + セッション報告書

---

## 10. 次のセッションで Claude が見るべきもの

1. このファイル全体（特に §2.7 注意点 / §6 関連知識 / §8 教訓）
2. `CLAUDE.md` §10 出席判定（最新版）
3. `docs/reference-map.md` §14a / §14b
4. `lib/logic/attendance.ts`（出席判定の真実）
5. `lib/multi-facility.ts`（職員取得の真実）
6. `supabase/migrations/154_*.sql`, `155_*.sql`（RPC 定義）

> **重要**: deaf-ic では employees の RLS を**触らない**こと（migration 144→145 ロールバック歴あり）。職員取得が必要なら必ず `fetchFacilityMembers` (migration 155 RPC) 経由。
