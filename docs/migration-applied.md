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

## 既知の不整合 (適用済 ≠ migration ファイル)

| 領域 | 内容 | 発覚日 | 対応 |
|---|---|---|---|
| `storage.objects` policy (documents) | migration 118 のファイル定義 (authenticated 全員 manage) が本番に未適用。Dashboard で別途厳格 policy が手動定義されていた | 2026-05-25 | migration 207 で policy を再定義 + Dashboard 編集禁止ルールを CLAUDE.md §16 に明記 |

## 注記

- 通し番号は単調増加。番号の欠番 (例: 118 が本番に居なかった件) は本番 DB に流れていない可能性があるため、原因不明なバグ調査時は `scripts/probe-*.mjs` で実 DB の policy / 関数 / 列を引いて事実を確認する
- 適用前に snapshot を取り (RLS の場合)、適用後に再 snapshot を取って差分を git diff で残すと、将来「いつ何が変わったか」が辿れる
