-- 136_ensure_employee_columns.sql
-- lib/types.ts の Employee 型が期待するカラムを全て idempotent に揃える。
--
-- 経緯:
--   - migration 003 / 012 / 014 / 015 / 019 / 102 / 103 / 117 / 122 / 129 などで
--     断続的に追加されてきたが、未適用の環境や、コード追加時に migration を
--     書き忘れた列 (e.g. custom_fields) が散在
--   - 結果として「列が見つからない」エラーが発生
--
-- 本 migration は employees テーブルの全アプリ用カラムを `add column if not exists`
-- で揃える。何度実行しても安全 (idempotent)。

-- ============================================================
-- 基本情報 (1-1)
-- ============================================================
alter table public.employees add column if not exists employee_number text;
alter table public.employees add column if not exists last_name        text;
alter table public.employees add column if not exists first_name       text;
alter table public.employees add column if not exists last_name_kana   text;
alter table public.employees add column if not exists first_name_kana  text;
alter table public.employees add column if not exists birth_date       text;
alter table public.employees add column if not exists gender           text;
alter table public.employees add column if not exists postal_code      text;
alter table public.employees add column if not exists address          text;
alter table public.employees add column if not exists phone            text;
alter table public.employees add column if not exists position         text;
alter table public.employees add column if not exists position_id      uuid;
alter table public.employees add column if not exists years_of_service integer;
alter table public.employees add column if not exists job_type         text;
alter table public.employees add column if not exists work_location    text;
alter table public.employees add column if not exists join_date        text;
alter table public.employees add column if not exists retirement_date  text;
alter table public.employees add column if not exists retirement_reason text;

-- 振込先口座
alter table public.employees add column if not exists bank_name           text;
alter table public.employees add column if not exists bank_branch_name    text;
alter table public.employees add column if not exists bank_account_type   text;
alter table public.employees add column if not exists bank_account_number text;
alter table public.employees add column if not exists bank_account_holder text;

-- 通勤フラグ
alter table public.employees add column if not exists has_car_commute    boolean not null default false;
alter table public.employees add column if not exists is_shuttle_driver  boolean not null default false;

-- マイカー通勤詳細
alter table public.employees add column if not exists car_model              text;
alter table public.employees add column if not exists car_plate_number       text;
alter table public.employees add column if not exists license_type           text;
alter table public.employees add column if not exists license_number         text;
alter table public.employees add column if not exists license_expiry         text;
alter table public.employees add column if not exists insurance_company      text;
alter table public.employees add column if not exists insurance_policy_number text;
alter table public.employees add column if not exists insurance_expiry       text;
alter table public.employees add column if not exists vehicle_inspection_expiry text;
alter table public.employees add column if not exists parking_location       text;
alter table public.employees add column if not exists commute_distance       text;

-- 運転関連 (マイカー・送迎共通)
alter table public.employees add column if not exists driving_experience    text;
alter table public.employees add column if not exists accident_history      text;
alter table public.employees add column if not exists training_attendance   text;

-- 通勤手段・区間
alter table public.employees add column if not exists commute_method        text;
alter table public.employees add column if not exists commute_time_minutes  integer;
alter table public.employees add column if not exists route_section1_route  text;
alter table public.employees add column if not exists route_section1_transport text;
alter table public.employees add column if not exists route_section1_cost   integer;
alter table public.employees add column if not exists route_section2_route  text;
alter table public.employees add column if not exists route_section2_transport text;
alter table public.employees add column if not exists route_section2_cost   integer;
alter table public.employees add column if not exists commute_route_detail  text;

-- 画像 path
alter table public.employees add column if not exists license_image_path        text;
alter table public.employees add column if not exists license_image_back_path   text;
alter table public.employees add column if not exists commute_route_image_path  text;

-- 緊急連絡先 1
alter table public.employees add column if not exists emergency1_name         text;
alter table public.employees add column if not exists emergency1_relationship text;
alter table public.employees add column if not exists emergency1_phone        text;
alter table public.employees add column if not exists emergency1_mobile       text;
alter table public.employees add column if not exists emergency1_postal_code  text;
alter table public.employees add column if not exists emergency1_address      text;

-- 緊急連絡先 2
alter table public.employees add column if not exists emergency2_name         text;
alter table public.employees add column if not exists emergency2_relationship text;
alter table public.employees add column if not exists emergency2_phone        text;
alter table public.employees add column if not exists emergency2_mobile       text;
alter table public.employees add column if not exists emergency2_postal_code  text;
alter table public.employees add column if not exists emergency2_address      text;

-- 身元保証人
alter table public.employees add column if not exists guarantor_name         text;
alter table public.employees add column if not exists guarantor_birth_date   text;
alter table public.employees add column if not exists guarantor_postal_code  text;
alter table public.employees add column if not exists guarantor_address      text;
alter table public.employees add column if not exists guarantor_phone        text;
alter table public.employees add column if not exists guarantor_relationship text;

-- ============================================================
-- 自己紹介・業務経歴 (1-2)
-- ============================================================
alter table public.employees add column if not exists self_introduction      text;
alter table public.employees add column if not exists current_duties         text;
alter table public.employees add column if not exists past_duties            text;
alter table public.employees add column if not exists qualifications         text[] not null default '{}'::text[];
alter table public.employees add column if not exists shift_qualifications   text[] not null default '{}'::text[];
alter table public.employees add column if not exists efforts_focused_on     text;
alter table public.employees add column if not exists how_others_describe    text;
alter table public.employees add column if not exists values_and_motivation  text;

-- ============================================================
-- 働き方の好み (1-3)
-- ============================================================
alter table public.employees add column if not exists work_style_solo_vs_team    text;
alter table public.employees add column if not exists work_style_clear_vs_autonomy text;
alter table public.employees add column if not exists work_style_stable_vs_change  text;
alter table public.employees add column if not exists work_style_think_vs_act     text;
alter table public.employees add column if not exists multitask_ability           text;
alter table public.employees add column if not exists detail_orientation          text;

-- ============================================================
-- コミュニケーション傾向 (1-4)
-- ============================================================
alter table public.employees add column if not exists comm_conclusion_vs_context  text;
alter table public.employees add column if not exists comm_consult_timing          text;
alter table public.employees add column if not exists comm_feedback_preference     text;
alter table public.employees add column if not exists comm_channel_preference      text;
alter table public.employees add column if not exists meeting_behavior             text;
alter table public.employees add column if not exists relationship_notes           text;

-- ============================================================
-- 強み・弱み (1-5)
-- ============================================================
alter table public.employees add column if not exists strength_1            text;
alter table public.employees add column if not exists strength_2            text;
alter table public.employees add column if not exists strength_3            text;
alter table public.employees add column if not exists weakness_1            text;
alter table public.employees add column if not exists weakness_2            text;
alter table public.employees add column if not exists weakness_3            text;
alter table public.employees add column if not exists success_experience    text;
alter table public.employees add column if not exists success_reason        text;
alter table public.employees add column if not exists struggle_experience   text;
alter table public.employees add column if not exists struggle_reason       text;
alter table public.employees add column if not exists suited_tasks          text;
alter table public.employees add column if not exists burden_tasks          text;

-- ============================================================
-- 価値観・カルチャー (1-6)
-- ============================================================
alter table public.employees add column if not exists workplace_values         text;
alter table public.employees add column if not exists ideal_boss_colleague     text;
alter table public.employees add column if not exists disliked_atmosphere      text;
alter table public.employees add column if not exists growth_goal              text;
alter table public.employees add column if not exists preferred_evaluation     text;
alter table public.employees add column if not exists safe_environment         text;
alter table public.employees add column if not exists strengths_self_reported  text;
alter table public.employees add column if not exists work_style_preference    text;

-- ============================================================
-- チーム相性 (1-7)
-- ============================================================
alter table public.employees add column if not exists team_role_preference text;
alter table public.employees add column if not exists easy_to_work_with    text;
alter table public.employees add column if not exists hard_to_work_with    text;
alter table public.employees add column if not exists team_mindset         text;

-- ============================================================
-- 追加 / カスタム / 誓約
-- ============================================================
alter table public.employees add column if not exists my_number             text;
alter table public.employees add column if not exists previous_employer     text;
-- カスタムフィールド: コードで Record<string, string> として扱われている → jsonb
alter table public.employees add column if not exists custom_fields         jsonb;
alter table public.employees add column if not exists pledge_confirmed_at   timestamptz;

-- ============================================================
-- シフト系 (migration 103 由来)
-- ============================================================
alter table public.employees add column if not exists employment_type           text default 'part_time';
alter table public.employees add column if not exists default_start_time        time;
alter table public.employees add column if not exists default_end_time          time;
alter table public.employees add column if not exists pickup_transport_areas    text[] not null default '{}'::text[];
alter table public.employees add column if not exists dropoff_transport_areas   text[] not null default '{}'::text[];
alter table public.employees add column if not exists is_qualified              boolean not null default false;
alter table public.employees add column if not exists is_driver                 boolean not null default false;
alter table public.employees add column if not exists is_attendant              boolean not null default false;
alter table public.employees add column if not exists shift_display_order       integer;
