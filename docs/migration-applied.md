# migration-applied.md — 本番 DB 適用済 migration 台帳

本リポジトリには `supabase_migrations.schema_migrations` のような自動追跡テーブルが**存在しない**。
そのため migration ファイルが書かれていても、本番 DB に流したかどうかは別途記録しないと追跡できない。

**ルール**:
1. 新規 migration を `supabase/migrations/` に追加したら、必ず対応する `scripts/apply-migration-NNN.mjs` で本番 DB に流す
2. 流したらこのファイルに 1 行追記する (番号 / ファイル名 / 適用日 / 適用者 / 検証スクリプト)
3. Supabase Dashboard で policy / function を**直接編集しない** (CLAUDE.md §16 参照)
4. RLS 系を変更したら `scripts/snapshot-storage-policies.mjs` を流して `docs/storage-policy-snapshot.json` の diff を commit に同梱する

> Phase 1 開始 (migration 200 番以降) からの記録。199 番以下は履歴を遡れないため空欄。

| 番号 | ファイル | 適用日 | 適用者 | 適用/検証スクリプト |
|---|---|---|---|---|
| 200 | `200_push_subscriptions.sql` | 2026-05-23 | nan457913@gmail.com | `scripts/apply-migration-200.mjs` |
| 201 | `201_push_notifications_v2.sql` | 2026-05-23 | nan457913@gmail.com | `scripts/apply-migration-201.mjs` |
| 202 | `202_pg_cron_engagement_digest.sql` | 2026-05-23 | nan457913@gmail.com | `scripts/apply-migration-202.mjs` |
| 203 | `203_docs_submitted_audience_aware.sql` | 2026-05-25 | nan457913@gmail.com | `scripts/apply-migration-203.mjs` |
| 204 | `204_manuals_manager_rls.sql` | 2026-05-25 | nan457913@gmail.com | `scripts/apply-migration-204.mjs` |
| 205 | `205_category_audience.sql` | 2026-05-25 | nan457913@gmail.com | `scripts/apply-migration-205.mjs` |
| 206 | `206_category_audience_managed_facilities_fix.sql` | 2026-05-25 | nan457913@gmail.com | `scripts/apply-migration-206.mjs` |
| 207 | `207_storage_documents_rls_fix.sql` | 2026-05-25 | nan457913@gmail.com | `scripts/apply-migration-207.mjs` + `scripts/snapshot-storage-policies.mjs` |
| 210 | `210_documents_rls_active_only.sql` | 2026-05-26 | 2han2be4han@gmail.com | `scripts/apply-migration-210.mjs` + `scripts/snapshot-storage-policies.mjs` |
| 211 | `211_can_access_media_path_rpc.sql` | 2026-05-26 | 2han2be4han@gmail.com | `scripts/apply-migration-211.mjs` |
| 212 | `212_documents_bucket_size_limit_200mb.sql` | 2026-05-26 | 2han2be4han@gmail.com | `scripts/apply-migration-212.mjs` |
| 213 | `213_videos_storage_bucket.sql` | 2026-05-27 | 2han2be4han@gmail.com | `scripts/apply-migration-213.mjs` + `scripts/snapshot-storage-policies.mjs` |
| 214 | `214_shift_manager_staff_edit_rpc.sql` | 2026-05-28 | 2han2be4han@gmail.com | `scripts/apply-migration-214.mjs`（RPC のみ・storage 非変更のため snapshot 不要） |
| 215 | `215_notification_queue_first_scheduled_default.sql` | 2026-05-31 | 2han2be4han@gmail.com | `scripts/apply-migration-215.mjs`（`first_scheduled_at` に DEFAULT now()。シフト通知 enqueue が NOT NULL 違反で全失敗していた真因の再発防止ガード。storage 非変更のため snapshot 不要。before/after dry-run で「省略 INSERT が BEFORE=失敗→AFTER=成功」を実証） |
| 216 | `216_shift_confirmations.sql` | 2026-05-31 | 2han2be4han@gmail.com | `scripts/apply-migration-216.mjs`（新テーブル `shift_confirmations` + RLS 5本 + `sa_employee_facility_shifts`(160) を ready 含むよう drop&recreate。シフト「確認しました」機能。apply 時に employee 視点 probe で published 6月=318件（回帰なし）を確認。storage 非変更のため snapshot 不要。docs/features/shift-confirmation-and-badge.md） |
| 217 | `217_facility_shift_view_employees_rpc.sql` | 2026-06-08 | 2han2be4han@gmail.com | `scripts/apply-migration-217.mjs`（新 SECURITY DEFINER RPC `get_my_facility_shift_view_employees(uuid[])`。/my/requests?tab=facility-shift で employee が自分しか見えなかった真因＝employees の RLS「自分のみ」+ 既存 `get_facility_members` が employee を弾く設計、を解消。全ロール対応・最小列のみ。apply 時にパレットの実 employee 視点で 1件→16件（主14+兼任2）に増えるのを確認。storage 非変更のため snapshot 不要） |

| 218 | `218_shift_assignment_halfday.sql` | 2026-06-17 | 2han2be4han@gmail.com | `scripts/apply-migration-218.mjs`（`shift_assignments_assignment_type_check` に `am_off`/`pm_off` 追加。半休をシフト割当でも表現可能にする。apply時に am_off の INSERT が制約を通過することを rollback付きで実証。storage非変更のため snapshot不要。docs/features/shift-halfday-availability-reflection.md） |
| 219 | `219_shift_day_notes.sql` | 2026-07-03 | 2han2be4han@gmail.com | `scripts/apply-migration-219.mjs`（新テーブル `shift_day_notes`（シフト表 日別メモ2行, 先方要望①）+ UNIQUE + set_updated_at トリガ + RLS 2本（admin=テナント全域 / manager・shift_manager=管轄施設、employee ポリシーなし）。apply時に upsert→onConflict update→delete を rollback付きで実証。接続は pooler 経由（constraints §2）。storage非変更のため snapshot不要。docs/features/shift-notes-copypaste-crossfacility.md） |
| 220 | `220_shift_day_notes_3rows_and_labels.sql` | 2026-07-07 | 2han2be4han@gmail.com | `scripts/apply-migration-220.mjs`（(A) `shift_day_notes.row_no` CHECK を (1,2)→(1,2,3) に拡張＝メモ3行化 / (B) 新テーブル `shift_day_note_labels`（施設×月×行番号→名称, UNIQUE + set_updated_at + RLS 2本）＝メモ行名称を月ごとに変更可。apply時に row_no=3 INSERT と labels upsert→update を rollback付きで実証。storage非変更のため snapshot不要。docs/features/shift-notes-copypaste-crossfacility.md） |

| 221 | `221_billing_snack_fee_override.sql` | 2026-07-17 | 2han2be4han@gmail.com | `scripts/apply-migration-221.mjs`（`billing_summaries.snack_fee_override integer null` + CHECK(null or >=0)。利用料金表「おやつ等」を ▲▼ で ±50円(=±1日分) 手動調整可にする。null=自動算出で出席日数に追従 / not null=その月は固定。apply時に rollback付きで override=550/0/null の upsert 成功・-50 が CHECK 拒否・**既存201行すべて null（＝過去月の金額が1円も変わらない後方互換）** を実証。RLS は既存 policy が `for all` のため変更不要（適用後も `bs_admin_all[ALL]` / `bs_manager_facility[ALL]` の2本を確認）。storage非変更のため snapshot不要。docs/features/billing-snack-fee-adjustable.md） |
| 222 | `222_billing_fee_items.sql` | 2026-08-08 | 2han2be4han@gmail.com | `scripts/apply-migration-222.mjs`（新テーブル 3 本: `billing_fee_items`（請求項目マスタ）/ `children_fee_amounts`（児童別月額）/ `billing_summary_fee_amounts`（月次スナップショット）+ RLS 6 本。利用料金表の請求項目を事業所が自由に追加・削除できるようにする。`calc_type` は per_day / per_child_monthly / monthly_fixed / checkbox の 4 種。**`billing_summary_fee_amounts.fee_item_id` は `on delete restrict`** ＝ スナップショットを持つ項目は物理削除できず、過去月の紙の金額が守られる（UI は「有効 OFF」を案内）。`system_key` に部分 UNIQUE INDEX を張り移行スクリプトを冪等化。apply 時に rollback 付きで 4 方式の INSERT / system_key 重複拒否 / 不正 calc_type 拒否 / **amount_override の 0 と null の区別** / 負値拒否 / スナップショット有り項目の DELETE 拒否 / 無し項目の DELETE 可 を実証。RLS は既存の請求系と同一述語（`get_my_role() = ANY(ARRAY['manager','shift_manager'])`）を**直接記述**し migration 140 の上書きに依存しない。storage 非変更のため snapshot 不要。docs/features/billing-configurable-items.md） |
| 223 | `223_children_sibling_group.sql` | 2026-08-08 | 2han2be4han@gmail.com | `scripts/apply-migration-223.mjs`（新テーブル `sibling_groups` + `children.sibling_group_id`（`on delete set null`）+ RLS 2 本。利用料金表で兄弟ごとの小計行を出すため。apply 時に **既存 children 78 行すべて sibling_group_id=null（＝現行の表示・計算に影響しない後方互換）** を確認し、rollback 付きでグループ作成 / 児童 2 名の紐付け / label 重複拒否 / グループ削除で児童は残り紐付けだけ null に戻る（set null）を実証。storage 非変更のため snapshot 不要） |
| 224 | `224_sibling_groups_tenant_scope.sql` | 2026-08-08 | 2han2be4han@gmail.com | `scripts/apply-migration-224.mjs`（兄弟グループを**法人全体スコープ**化。兄弟が別事業所に通うケースに対応。UNIQUE を `(tenant_id, facility_id, label)` → `(tenant_id, label)` に張り替え（同じ世帯が事業所ごとに重複登録されるのを防ぐ）+ `billing_facility_id`（請求担当事業所, on delete set null）追加 + `sg_manager_facility` を `sg_manager_tenant`（テナントスコープ）に置換。<br>**きょうだい合計は自事業所の児童のみ**という決定に基づき、`children` / `billing_summaries` / `billing_summary_fee_amounts` / `children_fee_amounts` の RLS は**一切変更していない**（＝事業所分離は緩めない）。apply スクリプトはこの 4 テーブルの policy 述語を適用前後でスナップショット比較し、**完全に同一であること**を毎回検証する。<br>apply 時に rollback 付きで 別事業所からの同名グループ作成が拒否される / 事業所をまたいだ児童の紐付け / 請求担当の変更と解除 を実証。既存 0 件のため張り替え衝突なし。storage 非変更のため snapshot 不要） |
| （データ移行） | `scripts/migrate-billing-fee-items.mjs` | 2026-08-08 | 2han2be4han@gmail.com | migration ではなくデータ移行。**既定 dry-run / `--apply` で実行 / 冪等**。4 事業所 × 3 組込項目（おやつ等 per_day ¥50 / 教材印刷代 per_child_monthly / 他施設利用 checkbox ¥0）をシード、`children.kumon_monthly_fee` 26 件を `children_fee_amounts` へ、`billing_summaries` 302 行 × 2 項目 = 604 件を `billing_summary_fee_amounts` へ複写。**移行前後のライブ算出額を実データ（schedule_entries の出席日数）で突合し、不一致 0 件・合計 ¥278,350 完全一致を確認してから COMMIT**（不一致なら自動 ROLLBACK）。再実行時は「新規 0 / 既存 12」で冪等性も確認済 |

## 遡及確認 (199 番以前・probe で事実確認したもの)

本表の記録は 200 番以降が対象だが、`docs/reference-map.md` が「🆕 未適用」と記載していた 115 / 116 / 130 / 131 について、
実 DB を probe して**いずれも適用済**であることを確認したため、事実として以下に記録する (適用日・適用者は履歴を遡れないため不明)。

| 番号 | ファイル | 適用状況 | 確認日 | 確認方法 |
|---|---|---|---|---|
| 115 | `115_remove_departments_and_position_role.sql` | ✅ 適用済 (適用日不明) | 2026-07-17 | `scripts/probe-migration-115-116-130.mjs`。`departments` / `employee_departments` / `manager_departments` / `employees.department` / `positions.system_role` が**いずれも存在しない**＝ drop 済 |
| 116 | `116_facility_core_time_and_meta.sql` | ✅ 適用済 (適用日不明) | 2026-07-17 | 同上。`facility_shift_settings.core_start_time` / `core_end_time` + `facilities.display_order` / `shift_enabled` / `transport_enabled` の 5 列すべて存在 |
| 130 | `130_employee_facilities.sql` | ✅ 適用済 (適用日不明) | 2026-07-17 | 同上。`employee_facilities` テーブル存在 (兼任 2 行) + ヘルパー 3/3 (`get_my_facility_ids` / `get_my_managed_facility_ids` / `employee_belongs_to_facility`) + 重複防止トリガ 2/2 (`employees_dedupe_primary_facility` / `ef_skip_primary_dup`) |
| 131 | `131_multi_facility_rls.sql` | ✅ 適用済 (適用日不明) | 2026-07-17 | `scripts/probe-migration-131-rls.mjs`。対象 17 policy の `pg_policies.qual` 全文を取得し、**17/17 が 131 版・旧(127/128)版 0 件・欠落 0 件**。判別基準は下記 |

### 131 の判別基準と決定的証拠

`pg_policies.qual` の本体で世代を判別した。

- **127/128 版** … `facility_id = (SELECT employees.facility_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)` — 主所属 1 施設のみ・兼任非対応・スカラー比較
- **131 版** … `facility_id IN (SELECT get_my_managed_facility_ids())` — 兼任対応・ヘルパー関数経由

ただし `get_my_managed_facility_ids()` 形は **140 (`140_shift_manager_role.sql`) も同じ形で policy を作り直している**ため、
この印だけでは 131 と 140 を区別できない。131 固有の証拠は次の 2 点:

1. **`employee_in_my_managed_facilities(uuid)` が本番に存在する** — この関数を `create` しているのは 131 のみ (140 は*参照するだけ*)。140 が単独で流れても本関数は生えない
2. **policy `sa_employee_cross_facility_select` が本番に存在する** — 131 だけが作る policy (140 には無い)。同様に `sr_employee_own` の WITH CHECK が `get_my_facility_ids()` を参照するのも 131 版の形

加えて `get_manager_subordinate_ids()` の定義本体が `employee_facilities` を参照している (= 131 が置換した兼任対応版)。
**結論: 131 は適用済。現行の policy 本体は、その上に 140 が shift_manager を足した上書き版** (多くの policy で `get_my_role() = ANY (ARRAY['manager','shift_manager'])` になっている)。

## 既知の不整合 (適用済 ≠ migration ファイル)

| 領域 | 内容 | 発覚日 | 対応 |
|---|---|---|---|
| `storage.objects` policy (documents) | migration 118 のファイル定義 (authenticated 全員 manage) が本番に未適用。Dashboard で別途厳格 policy が手動定義されていた | 2026-05-25 | migration 207 で policy を再定義 + Dashboard 編集禁止ルールを CLAUDE.md §16 に明記 |
| `docs/reference-map.md` の適用済欄 (115/116/130/131) | 台帳が 4 件を「🆕 未適用」と記載していたが、実 DB では**いずれも適用済**だった。118 の事故と逆方向 (ファイルは流れているのに台帳が未適用と主張) の台帳腐り。RLS 系の調査でこの台帳を根拠にすると「兼任が効いていないはず」と誤診する危険があった | 2026-07-17 | 上記「遡及確認」表に事実を記録 + reference-map.md:32-35 を ✅ 適用済 に修正。probe スクリプト 2 本を残置し再確認可能にした |

## 注記

- 通し番号は単調増加。番号の欠番 (例: 118 が本番に居なかった件) は本番 DB に流れていない可能性があるため、原因不明なバグ調査時は `scripts/probe-*.mjs` で実 DB の policy / 関数 / 列を引いて事実を確認する
- **台帳の腐りは双方向に起きる**。118 は「ファイルがあるのに流れていない」、115/116/130/131 は逆に「流れているのに台帳が未適用と主張」だった (2026-07-17 発覚)。**どちらの向きにも台帳を無条件で信じない**。「適用済と書いてあるから効いているはず」も「未適用と書いてあるから効いていないはず」も、どちらも実 DB を引くまでは仮説にすぎない
- policy の世代判定は policy 名の有無では足りない。**後続 migration が同名 policy を `drop` → `create` で作り直している**ことがあるため (131 の policy 群を 140 が上書きした例)、`pg_policies.qual` の**本体**で判別する。判別の印が複数 migration に跨るときは、**その migration だけが `create` する関数・policy** を証拠に選ぶ
- 適用前に snapshot を取り (RLS の場合)、適用後に再 snapshot を取って差分を git diff で残すと、将来「いつ何が変わったか」が辿れる
