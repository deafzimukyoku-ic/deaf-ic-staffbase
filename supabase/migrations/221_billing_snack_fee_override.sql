-- 221_billing_snack_fee_override.sql
-- 利用料金表「おやつ等」の手動調整（docs/features/billing-snack-fee-adjustable.md）
--
-- 背景:
--   おやつ等は 出席日数 × SNACK_FEE_PER_DAY(50) の自動算出のみで画面から一切いじれなかった。
--   実運用では「当月おやつを数日分食べていない」等の微調整が発生するため、
--   料金表のセルで ▲▼（±50円 = ±1日分）の調整を可能にする。
--
-- 設計判断:
--   - snack_fee_override が null      = 自動算出（出席日数 × 50）。出席日数の変更に追従する
--   - snack_fee_override が not null  = 手動調整済み。その月は固定され、出席日数を後から直しても追従しない
--   - 0 と null を区別する（0 = 手動で 0 円に固定 / null = 自動）。よってコード側は ?? を使い || を使わない
--   - 既存行は null になるため、過去に保存済みの月は従来どおり自動算出のまま（数字が変わらない = 後方互換）
--   - snack_fee（実効値のスナップショット列）は既存のまま残す。override はその「根拠」を持つ列
--
-- RLS: 変更なし。billing_summaries の既存ポリシー (bs_admin_all / bs_manager_facility) は
--      for all のため、新列も自動的に同ポリシー配下に入る。storage 非変更のため snapshot 不要。

alter table public.billing_summaries
  add column if not exists snack_fee_override integer null;

alter table public.billing_summaries
  drop constraint if exists billing_summaries_snack_fee_override_range;
alter table public.billing_summaries
  add constraint billing_summaries_snack_fee_override_range
  check (snack_fee_override is null or snack_fee_override >= 0);

comment on column public.billing_summaries.snack_fee_override is
  'おやつ等の手動調整額（円）。null = 自動算出（出席日数 × SNACK_FEE_PER_DAY）で出席日数に追従。'
  ' not null = 料金表セルの ▲▼ で調整済みのため、その月は固定（出席日数の事後変更に追従しない）。'
  ' 0 は「手動で0円に固定」を意味し null とは区別する。migration 221';
