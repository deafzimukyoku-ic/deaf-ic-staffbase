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

## 既知の不整合 (適用済 ≠ migration ファイル)

| 領域 | 内容 | 発覚日 | 対応 |
|---|---|---|---|
| `storage.objects` policy (documents) | migration 118 のファイル定義 (authenticated 全員 manage) が本番に未適用。Dashboard で別途厳格 policy が手動定義されていた | 2026-05-25 | migration 207 で policy を再定義 + Dashboard 編集禁止ルールを CLAUDE.md §16 に明記 |

## 注記

- 通し番号は単調増加。番号の欠番 (例: 118 が本番に居なかった件) は本番 DB に流れていない可能性があるため、原因不明なバグ調査時は `scripts/probe-*.mjs` で実 DB の policy / 関数 / 列を引いて事実を確認する
- 適用前に snapshot を取り (RLS の場合)、適用後に再 snapshot を取って差分を git diff で残すと、将来「いつ何が変わったか」が辿れる
