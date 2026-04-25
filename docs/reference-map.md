# reference-map.md — deaf-ic 参照台帳

プロジェクト内の「DBテーブル・カラム・定数・型・ロール・マイグレーション・コンポーネント」がどのファイルで参照されているかを記録する台帳。
**新規ファイル作成時・既存編集時は必ず更新すること。更新忘れ = 作業未完了。**

---

## 0. 適用済みマイグレーション（最新）

| 番号 | ファイル | 内容 | 適用済 |
|---|---|---|---|
| 001〜047 | staffbase 既存（all_migrations_combined.sql） | 初期スキーマ | ✅ |
| 090 | 090_drop_stripe_plan.sql | Stripe/plan削除、ロール3段階化 | ✅ |
| 091 | 091_manuals.sql | 業務マニュアル + manual_reads + categories.type='manual' | ✅ |
| 092 | 092_sort_order.sql | 4テーブルに sort_order 追加 + backfill | ✅ |
| 093 | 093_content_blocks.sql | content_blocks jsonb + trainings.body | ✅ |
| 100 | 100_shift_core.sql | shift-maker テーブル群（facility対応） | ✅ |
| 101 | 101_shift_rls.sql | shift系 RLS（facility単位） | ✅ |
| 102 | 102_shift_rpcs.sql | update_schedule_entry_attendance 等 RPC | ✅ |
| 103 | 103_employees_shift_fields.sql | employees に shift固有カラム + facility_shift_settings | ✅ |
| 104 | 104_shift_settings_extend.sql | facility_shift_settings 拡張 + employees.qualifications | ✅ |
| 105 | 105_schedule_entries_methods.sql | schedule_entries: pickup/dropoff_method/note + leave 追加 | ✅ |
| 106 | 106_notification_queue_shift.sql | notification_queue に shift_ready/shift_publish + facility_id/meta カラム | ✅ |
| 107 | 107_employee_ready_visibility.sql | employee の RLS を ready/published 両方閲覧可に拡張（案Z 仮シフト方式） | ✅ |
| 108 | 108_updated_by.sql | announcements/compliance_documents/trainings/manuals に updated_by カラム追加 | ✅ |
| 109 | 109_notification_queue_manual.sql | notification_queue.content_type に 'manual' 追加 | ✅ |
| 110 | 110_employee_progress_manuals.sql | employee_progress ビューに manuals_read 追加 | ✅ |
| 111 | 111_view_logs.sql | compliance/training/announcement/manual の view_logs ×4（何回見たか・いつ見たか） | ✅ |
| 112 | 112_transport_employee_ids.sql | transport_assignments: pickup/dropoff_staff_ids → pickup/dropoff_employee_ids 改名 | ✅ |
| 113 | 113_child_display_order_memory.sql | 児童 DnD 並び順記憶テーブル（slot_signature, child_id, display_order） | ✅ |
| 114 | 114_employees_qualifications_array_fix.sql | employees.qualifications を text → text[] に変換（104 が `add column if not exists` で skip された型ズレを是正） | ✅ |
| 115 | 115_remove_departments_and_position_role.sql | (A) departments / employee_departments / manager_departments 完全削除 + employees.department drop / (B) positions.system_role + 同期トリガー削除（役職→ロール自動連動を切断） | 🆕 未適用 |

---

## 0.08 権限マトリクス + 部署系完全削除（2026-04-25）

### 新規ファイル
| ファイル | 役割 |
|---|---|
| `app/(admin)/admin/access-matrix/page.tsx` | 管理者・マネージャーの施設アクセスをマトリクス編集 + 招待モーダル |
| `supabase/migrations/115_remove_departments_and_position_role.sql` | 部署系 4 テーブル/カラム削除 + positions.system_role + 同期トリガー削除 |

### 編集ファイル
| ファイル | 変更 |
|---|---|
| `app/api/employees/invite/route.ts` | role + manager_facility_ids を受け付け、bulk insert |
| `app/(admin)/layout.tsx` | shiftNav 「権限マトリクス」追加 |
| `lib/types.ts` | Department / EmployeeDepartment / ManagerDepartment 削除、Position.system_role 削除、各 Doc 型から target_department_ids 削除、employees.department 削除 |
| `components/admin/AttributeTargetSelector.tsx` | 部署タブ削除（施設 + 役職のみ） |
| 12 content pages × admin/mgr/employee | departments query / target_department_ids / employee_departments フィルタ削除 |
| `app/(admin)/admin/employees/[id]/page.tsx` | 「所属グループ」「管理担当グループ」UI セクション削除 |
| `app/(admin)/admin/employees/new/page.tsx` | dept_ids form 削除 |
| `app/(admin)/admin/settings/page.tsx` | 「グループ」設定セクション削除、役職セクションから system_role セレクタ削除 |
| `components/employee/ProfileSection1Basic.tsx` | 「所属グループ」プルダウン削除、`'department'` field type 削除 |
| `components/admin/EmployeeTable.tsx`, `components/manager/SubordinateTable.tsx`, `components/manager/SubordinateDetail.tsx` | dept 列・行削除 |
| `lib/ai-diagnosis-fields.ts`, `lib/manager-visible-fields.ts`, `lib/pdf-fields.ts` | 'department' フィールド削除 |
| `tsconfig.json` | exclude に diletto-shift-maker / diletto-staffbase 追加 |

### 影響範囲
- ❗ **migration 115 未適用**: コード側は dept 参照ゼロ。Supabase で `115_remove_departments_and_position_role.sql` 実行後に dept テーブル drop で完了
- 役職 (positions) は純粋なラベルになる。システム権限は employees.role + manager_facilities + access-matrix で管理

---

## 0.07 週次送迎出力追加分（2026-04-25）

### 新規ファイル
| ファイル | 役割 | 主な参照 |
|---|---|---|
| `components/shift/WeeklyTransportFull.tsx` | 週次送迎印刷ページ本体（A3 縦・1週=1ページ・91行/枚） | admin/mgr weekly-transport |
| `app/(admin)/admin/shifts/output/weekly-transport/page.tsx` | admin ラッパー | - |
| `app/(manager)/mgr/shifts/output/weekly-transport/page.tsx` | manager ラッパー | - |

### 編集ファイル
| ファイル | 変更 |
|---|---|
| `app/(admin)/layout.tsx` | shiftNav に「週次送迎」リンク追加 |
| `app/(manager)/layout.tsx` | 同上 |

### 参照テーブル・カラム
- `employees.{id, tenant_id, facility_id, last_name, first_name, role, default_*, pickup/dropoff_transport_areas, qualifications, is_*, shift_display_order, status}`
- `children.{id, name, display_order, ...}`
- `schedule_entries.{id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, attendance_status}`
- `transport_assignments.{schedule_entry_id, pickup_employee_ids, dropoff_employee_ids, ...}`
- `facility_shift_settings.{pickup_area_labels, dropoff_area_labels}`

### 共通ライブラリ参照（DailyOutputFull と同じ）
- `lib/shift-utils.ts` → staffDisplayName
- `lib/shift-logic/resolveTransportSpec.ts`
- `lib/shift-facility.ts` → useShiftFacilityId
- `lib/types.ts` 各 Row 型

---

## 0.06 タスクD（日次出力）追加分（2026-04-25）

### 新規ファイル
| ファイル | 役割 | 主な参照 |
|---|---|---|
| `lib/date/defaultOutputDate.ts` | 日次出力初期日: 平日→翌日 / 土→月 / 日→月 | DailyOutputFull |
| `components/shift/DailyOutputFull.tsx` | 日次出力ページ本体（ホワイトボード風 A3 縦印刷） | admin/mgr daily |
| `app/(admin)/admin/shifts/output/daily/page.tsx` | DailyOutputFull の admin ラッパー | - |
| `app/(manager)/mgr/shifts/output/daily/page.tsx` | DailyOutputFull の manager ラッパー | - |

### 参照しているテーブル・カラム
- `employees.{id, tenant_id, facility_id, last_name, first_name, role, employment_type, default_start_time, default_end_time, pickup_transport_areas, dropoff_transport_areas, qualifications, is_qualified, is_driver, is_attendant, shift_display_order, status}`
- `children.*`（display_order 含む）
- `schedule_entries.{id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, attendance_status}`
- `shift_assignments.{employee_id, date, start_time, end_time, assignment_type, segment_order}`（publish_status は **フィルタしない**）
- `transport_assignments.{schedule_entry_id, pickup_employee_ids, dropoff_employee_ids, is_unassigned, is_confirmed}`
- `facility_shift_settings.{pickup_area_labels, dropoff_area_labels}`
- `child_display_order_memory.{slot_signature, child_id, display_order}` (via /api/shifts/transport/child-order)

### 参照している共通ライブラリ
- `lib/shift-utils.ts` → `staffDisplayName`
- `lib/shift-logic/resolveTransportSpec.ts` → `resolveEntryTransportSpec`
- `lib/date/holidays.ts` → `isJpHoliday / jpHolidayName`
- `lib/shift-facility.ts` → `useShiftFacilityId`
- `lib/types.ts` → `StaffRow / ChildRow / ScheduleEntryRow / ShiftAssignmentRow / TransportAssignmentRow / AreaLabel`
- `lib/constants.ts` → `GradeType`

---

## 0.05 編集者表示（ⓑ）対応（2026-04-25）

8ページの SELECT に `editor:employees!updated_by(...)` JOIN 追加 + UI に「編集者: ○○」表示（`created_by !== updated_by` 時のみ）。

| ファイル | JOIN 追加 | UI 追加 |
|---|---|---|
| app/(admin)/admin/announcements/page.tsx | ✅ | ✅ |
| app/(admin)/admin/compliance/page.tsx | ✅ | ✅ |
| app/(admin)/admin/trainings/page.tsx | ✅ | ✅ |
| app/(admin)/admin/manuals/page.tsx | ✅ | ✅ |
| app/(manager)/mgr/announcements/page.tsx | ✅ | 比較条件修正 (object→ID) |
| app/(manager)/mgr/compliance/page.tsx | ✅ | 比較条件修正 |
| app/(manager)/mgr/trainings/page.tsx | ✅ | 比較条件修正 |
| app/(manager)/mgr/manuals/page.tsx | ✅ | 比較条件修正 |

---

## 0.1 タスクA（シフト表）追加分の参照（2026-04-25）

### 新規ファイル
| ファイル | 役割 | 主な参照 |
|---|---|---|
| `lib/types.ts` | 追加: `StaffRow / ShiftRequestRow / ShiftAssignmentRow / ShiftChangeRequestRow / PublishStatus / ShiftAssignmentType / ShiftRequestType / ShiftChangeRequestType / ShiftChangeRequestStatus / ShiftChangeRequestPayload / LegacyNotificationContentType / ShiftNotificationContentType` | 全 shift コンポーネント・API |
| `lib/constants.ts` | 追加: `MAX_STAFF_PER_TRANSPORT / DEFAULT_MIN_QUALIFIED_STAFF / TRANSPORT_TRIP_GAP_MINUTES / PUBLISH_STATUSES` | generateShift / generateTransport (将来) |
| `lib/logic/generateShift.ts` | シフト自動生成ロジック（ルールベース） | ShiftFull |
| `lib/logic/qualifiedCoverage.ts` | カバレッジ計算（コアタイム重複・3名重複時間判定） | ShiftGridFull |
| `lib/date/isToday.ts` | `todayStr()` JST 日付 | ShiftGridFull |
| `lib/date/holidays.ts` | 祝日判定（@holiday-jp/holiday_jp） | ShiftGridFull |
| `lib/auth/shift-api-helpers.ts` | `resolveShiftAuth()` 共通認証 | shift API 群 |
| `lib/email/shift-notification-email.ts` | `buildShiftPublishEmail / buildShiftReadyEmail` | cron/send-notifications |
| `app/api/shifts/transition/route.ts` | publish_status 遷移 + 通知キュー enqueue | ShiftFull |
| `app/api/shifts/shift-change-requests/[id]/route.ts` | 変更申請の承認/却下（admin のみ） | ApprovalQueueFull |
| `components/shift/ShiftFull.tsx` | シフト表ページ本体（admin/manager 共通） | admin/shifts, mgr/shifts |
| `components/shift/ShiftGridFull.tsx` | シフトグリッド（職員×日付） | ShiftFull |
| `components/shift/ApprovalQueueFull.tsx` | 変更申請の承認キュー UI | ShiftFull (admin のみ) |
| `components/shift/MonthStepper.tsx` | 月切替コントロール（URL ?month=YYYY-MM） | ShiftFull |
| `app/(admin)/admin/shifts/page.tsx` | ShiftFull の admin ラッパー | - |
| `app/(manager)/mgr/shifts/page.tsx` | ShiftFull の manager ラッパー | - |

### 編集したファイル
| ファイル | 変更内容 |
|---|---|
| `lib/email/notification-email.ts` | 引数型を `LegacyNotificationContentType` に絞る（5タイプ展開対応） |
| `app/api/cron/send-notifications/route.ts` | `processShiftRow` 追加で shift_ready/shift_publish ディスパッチ |

---

## 1. ロール参照（lib/constants.ts EMPLOYEE_ROLES = ['employee','manager','admin']）

| ファイル | 参照内容 | 備考 |
|---|---|---|
| lib/constants.ts:23 | `EMPLOYEE_ROLES` 定義 | super_admin 削除済 |
| middleware.ts | role別ルーティング `/admin /mgr /my` | DEV_SKIP_AUTH 対応 |
| app/(auth)/login/page.tsx:56 | role別リダイレクト | super_admin 分岐削除済 |
| app/(employee)/layout.tsx:96 | manager/admin で「管理画面へ」表示 | - |
| app/api/admin/send-reminder/route.ts:25 | admin のみ実行可 | - |
| app/api/categories/route.ts:68,146 | admin/manager のみ作成可 | - |
| app/api/employees/invite/route.ts:21 | admin のみ招待可 | - |
| app/api/employees/upload-image/route.ts | admin のみ | - |
| app/api/field-visibility/route.ts | admin のみ | - |
| app/api/notifications/* | role別チェック | - |
| components/admin/EmployeeTable.tsx:44 | role !== 'admin' フィルタ | - |
| components/RoleSwitcher.tsx | super_admin削除に伴いnull返す | Phase 4で再実装予定 |
| supabase/migrations/090_drop_stripe_plan.sql | employees.role CHECK 制約 | - |
| supabase/migrations/101_shift_rls.sql | get_my_role() で admin/manager/employee 判定 | - |

---

## 2. publish_status 参照（draft / ready / published）

| ファイル | 参照内容 | 備考 |
|---|---|---|
| supabase/migrations/100_shift_core.sql | enum publish_status 定義 + shift_assignments + transport_assignments | - |
| supabase/migrations/101_shift_rls.sql | employee の旧 SELECT ポリシー（published のみ） | 107 で上書き |
| supabase/migrations/107_employee_ready_visibility.sql | employee は ready/published どちらも閲覧可（案Z） | - |
| lib/constants.ts | PUBLISH_STATUSES = ['draft','ready','published'] | - |
| lib/types.ts | `PublishStatus` 型 + `ShiftAssignmentRow.publish_status` | - |
| app/api/shifts/transition/route.ts | 遷移ルール（draft↔ready↔published） + 通知キュー enqueue | - |
| components/shift/ShiftFull.tsx | 月集約ステータス表示 + 遷移ボタン群 | - |

---

## 3. facility_id 参照

| ファイル | 参照内容 | 備考 |
|---|---|---|
| supabase/migrations/019_facilities.sql | facilities テーブル + employees.facility_id | staffbase 既存 |
| supabase/migrations/036_facility_scope.sql | announcements/trainings/compliance の target_facility_ids | staffbase 既存 |
| supabase/migrations/100_shift_core.sql | children/schedule_entries/shift_requests/shift_assignments/transport_assignments/shift_change_requests/attendance_audit_logs/child_area_eligible_staff | 全 facility_id 必須 |
| supabase/migrations/101_shift_rls.sql | manager は自 facility_id のみ操作可 | RLS |
| supabase/migrations/103_employees_shift_fields.sql | facility_shift_settings.facility_id | - |
| components/admin/AttributeTargetSelector.tsx | target_type/target_facility_ids UI | - |
| components/admin/FacilityScopeSelector.tsx | applyScopeFilter 関数 | - |

---

## 4. tenant_id 参照

staffbase 既存の全テーブルが対象。`get_my_tenant_id()` PostgreSQL関数で参照。
**重要**: 全 RLS ポリシーで tenant_id チェック必須。新テーブル作成時は必ず追加。

---

## 5. 主要DBテーブル一覧

### staffbase 由来（継承）
| テーブル名 | 主なカラム | facility対応 | 備考 |
|---|---|---|---|
| tenants | id, company_name, representative_name, logo_url | N/A（NPO単一） | Stripe関連削除済（migration 090） |
| facilities | id, tenant_id, name, address | - | 4事業所予定（seed未投入） |
| departments | id, tenant_id, name, display_order | 部門単位 | - |
| positions | id, tenant_id, name, display_order | - | 役職 |
| employees | id, facility_id, role(admin/manager/employee), full_name, last_name, first_name, … | 済 | migration 103 で shift系カラム追加 |
| document_templates | id, tenant_id, type, … | tenant単位 | PDF テンプレ |
| document_submissions | id, employee_id, template_id, form_data | - | - |
| categories | id, tenant_id, type(compliance/training/announcement/manual), name, color, icon | tenant単位 | type に 'manual' 追加（migration 091） |
| compliance_documents | id, tenant_id, title, content, **content_blocks**, category_id, **sort_order**, target_* | facility_scope | sort_order=092、content_blocks=093 |
| compliance_acknowledgments | id, employee_id, doc_id, document_updated_at | - | - |
| trainings | id, tenant_id, title, **body**, **content_blocks**, pdf_storage_path, youtube_url, category_id, **sort_order**, target_* | facility_scope | body=093, content_blocks=093 |
| training_submissions | id, employee_id, training_id, result | - | - |
| announcements | id, tenant_id, title, body, **content_blocks**, category_id, **sort_order**, target_* | facility_scope | sort_order=092, content_blocks=093 |
| announcement_reads | id, announcement_id, employee_id, read_at | - | - |
| manuals | id, tenant_id, title, body, pdf_storage_path, **content_blocks**, category_id, **sort_order**, target_* | facility_scope | 091 で新設、sort_order=092、content_blocks=093 |
| manual_reads | manual_id, employee_id, read_at | - | 091 |
| ai_diagnoses | id, employee_id, type, result | - | - |
| ai_diagnosis_usage | id, tenant_id, year_month, count | - | - |
| notification_queue | id, tenant_id, content_type, content_id, scheduled_at | - | - |
| custom_employee_fields | id, tenant_id, field_key, field_type | - | - |
| field_visibility | employee_id, field_key | - | - |

### shift-maker 由来（migration 100/101/102/103 適用済）
| テーブル名 | 主なカラム | 備考 |
|---|---|---|
| children | id, tenant_id, **facility_id**, name, grade_type, custom_pickup_areas, custom_dropoff_areas | RLS済 |
| schedule_entries | id, tenant_id, **facility_id**, child_id, date, pickup_time, dropoff_time, attendance_status | RPC 経由更新 |
| shift_requests | id, tenant_id, **facility_id**, employee_id, month, request_type, dates[] | - |
| shift_assignments | id, tenant_id, **facility_id**, employee_id, date, start_time, end_time, **publish_status** | enum publish_status |
| transport_assignments | id, tenant_id, **facility_id**, schedule_entry_id, direction, employee_id, **publish_status** | - |
| shift_change_requests | id, tenant_id, **facility_id**, employee_id, change_type, status | - |
| attendance_audit_logs | id, tenant_id, **facility_id**, schedule_entry_id, changed_by_name, old/new_status | RPC で自動記録 |
| child_area_eligible_staff | child_id, area_id, employee_id, direction | - |
| facility_shift_settings | facility_id, min_qualified_staff, pickup/dropoff_area_labels | migration 103 |

### 削除済
| テーブル/カラム | 削除元 |
|---|---|
| tenants.stripe_customer_id, stripe_subscription_status | migration 090 |
| tenants.plan | migration 090 |
| staff（shift-maker） | 作成せず（employees に統合） |

---

## 6. 主要定数参照（lib/constants.ts）

| 定数名 | 場所 | 値 | 参照ファイル |
|---|---|---|---|
| `MAX_DOCUMENTS_PER_TENANT` | lib/constants.ts:4 | 10 | upload系 |
| `MAX_PAYROLL_BANKS_PER_TENANT` | lib/constants.ts:5 | 3 | - |
| `MAX_AI_DIAGNOSIS_PER_MONTH` | lib/constants.ts:6 | 30 | AI 診断 |
| `MAX_DOCX_FILE_SIZE_MB` | lib/constants.ts:7 | 5 | - |
| `TRAINING_SUMMARY_MIN_CHARS` | lib/constants.ts:9 | 300 | training submission |
| `AI_MODEL` | lib/constants.ts:10 | 'claude-haiku-4-5' | AI 診断 API |
| `MAPPING_SOURCE_TYPES` | lib/constants.ts:14 | employee/tenant/form_data/fixed | PDF タグ |
| `INPUT_TYPES` | lib/constants.ts:17 | text/textarea/date/number/select | - |
| `VISIBILITY_CONDITIONS` | lib/constants.ts:20 | all/car_commute_only/shuttle_driver_only | - |
| `GRADE_TYPES`, `GradeType`, `GRADE_LABELS`, `GRADE_GROUPS` | lib/constants.ts | 16種学年区分 + 表示ラベル + タブ用グループ（未就学・幼稚園/小学生/中高生） | ChildrenManager |
| `TRANSPORT_DIRECTIONS`, `TRANSPORT_DIRECTION_LABELS` | lib/constants.ts | pickup/dropoff + 日本語ラベル | 送迎表（Phase 4 Step 5）で使用予定 |
| `EMPLOYEE_ROLES` | lib/constants.ts:23 | employee/manager/admin | 全ロール参照箇所 |
| `EMPLOYEE_STATUS` | lib/constants.ts:26 | active/retired | - |
| `DOCUMENT_STATUS` | lib/constants.ts:29 | draft/submitted/approved | - |
| `TRAINING_RESULT` | lib/constants.ts:32 | pending/passed/failed/resubmit | - |
| `DIAGNOSIS_TYPES` | lib/constants.ts:35 | personality/strengths/culture_fit/team_compat | AI 診断 |
| `MAX_PDF_FILE_SIZE_MB` | lib/constants.ts:41 | 20 | PDF アップロード |
| `FONT_SIZES` | lib/constants.ts:42 | [8,10,12,...,48] | PDF タグ |
| `FONT_FAMILY` | lib/constants.ts:45 | 'Noto Sans JP'（固定） | PDF 描画 |
| `PDF_ASCENT_RATIO` | lib/constants.ts:46 | 0.76 | PDF y座標変換 |
| `PROFILE_SECTION_KEYS` | lib/constants.ts:55 | basic_extended/commute/contacts/intro/work_style/communication/strengths/values/team | プロフィール |

**未実装（Phase 2/4 以降）**:
- `PUBLISH_STATUS` (draft/ready/published) — migration 100 内に enum 定義はあり
- `MAX_STAFF_PER_TRANSPORT`, `DEFAULT_MIN_QUALIFIED_STAFF`, `TRANSPORT_TRIP_GAP_MINUTES`
- `ATTENDANCE_STATUS` (planned/present/absent/late/early_leave)

---

## 7. 主要型参照（lib/types.ts）

| 型名 | 場所 | 主な参照ファイル |
|---|---|---|
| `Tenant` | lib/types.ts:13 | settings/page.tsx 等 |
| `Employee` | lib/types.ts | employees ページ群 |
| `Facility` | lib/types.ts | admin/announcements 等 |
| `Department` | lib/types.ts | AttributeTargetSelector |
| `Position` | lib/types.ts | AttributeTargetSelector |
| `Category` | lib/types.ts:343 | CategoryManager, 4機能 |
| `AreaLabel`, `ChildRow` | lib/types.ts | 児童エリア + 児童レコード型。AreaLabel に address 追加（shift-puzzle 互換） |
| `ChildAreaEligibleStaffRow` | lib/types.ts | 児童専用エリアごとの担当可能職員（child_area_eligible_staff テーブル行） |
| `AttendanceStatus`, `ScheduleEntryRow` | lib/types.ts | 出欠・利用予定レコード型。ScheduleGrid / ScheduleCellEditor で使用 |
| `CategoryType` | lib/types.ts:326 | 'compliance/training/announcement/**manual**' |
| `**ContentBlockJson**` | lib/types.ts:326 | BlockEditor/BlockRenderer ※新規 |
| `**Manual**` | lib/types.ts:328 | 業務マニュアル (admin/mgr/my) |
| `ComplianceDoc` | lib/types.ts:363 | compliance pages |
| `Training` | lib/types.ts:387 | trainings pages（body+content_blocks 追加） |
| `Announcement` | lib/types.ts:415 | announcements pages |
| `AnnouncementRead` | lib/types.ts:430 | - |
| `TargetType` | lib/types.ts | 'all'/'facility' |
| `TagPlacement` | lib/types.ts | PDF テンプレ |

---

## 8. 主要コンポーネント

| コンポーネント | パス | 用途 |
|---|---|---|
| `BlockEditor` | components/admin/BlockEditor.tsx | text/image/video/PDF ブロック編集（admin 4機能で使用） |
| `BlockRenderer` | components/admin/BlockRenderer.tsx | content_blocks の表示（employee 4機能で使用） |
| `NewBadge` | components/admin/NewBadge.tsx | 7日以内作成アイテムに NEW バッジ |
| `ReorderButtons` | components/admin/ReorderButtons.tsx | sort_order 入れ替え（↑↓ボタン） |
| `Breadcrumb` | components/admin/Breadcrumb.tsx | パンくずリスト（admin/mgr/my 全画面） |
| `CategorySelect`, `CategoryBadge` | components/admin/CategorySelect.tsx | カテゴリ選択 + バッジ |
| `CategoryManager` | components/admin/CategoryManager.tsx | カテゴリ CRUD |
| `AttributeTargetSelector`, `TargetAttributeBadges` | components/admin/AttributeTargetSelector.tsx | 配信ターゲット設定（rounded-md に変更済） |
| `FacilityScopeSelector` + `applyScopeFilter` | components/admin/FacilityScopeSelector.tsx | 施設スコープ |
| `RoleSwitcher` | components/RoleSwitcher.tsx | （super_admin 削除につき null 返す。Phase 4 で再実装） |
| `PdfEditor`, `PdfDocumentForm` 等 | components/admin/, components/employee/ | PDF テンプレ系 |
| `ProgressDashboard` | components/admin/ProgressDashboard.tsx | admin ダッシュボード |
| `TrainingPlayer` | components/employee/TrainingPlayer.tsx | レガシー研修動画/PDF再生 |
| `Logo` | components/branding/Logo.tsx | NPOロゴ画像。`size=sm/md/lg`。ロゴ横の企業名テキストは撤去済（3レイアウト共通） |
| `PlaceholderPage` | components/shift/PlaceholderPage.tsx | Phase 4〜7 で実装予定ページ用の共通プレースホルダ（title/icon/description/phase） |
| `ChildrenSettingsFull` | components/shift/ChildrenSettingsFull.tsx | 児童管理（shift-puzzle 1031行を忠実移植、scope prop） |
| `[旧] ChildrenManager` | components/shift/ChildrenManager.tsx | 簡略版。ChildrenSettingsFull で置換済み（残置） |
| `[旧] AreaEditor` | components/shift/AreaEditor.tsx | 簡略版エリア編集。ChildrenSettingsFull は内部に CustomAreasEditor を持つ |
| `shift-compat/Modal` | components/shift-compat/Modal.tsx | shift-puzzle Modal の API そのまま（size: sm/md/lg/xl + title） |
| `shift-compat/Button` | components/shift-compat/Button.tsx | shift-puzzle Button の API そのまま（primary/secondary/cta-submit/app-card-cta） |
| `shift-compat/Badge` | components/shift-compat/Badge.tsx | shift-puzzle Badge の API そのまま（success/warning/error/info/neutral） |
| `lib/shift-utils.ts` | staffDisplayName / parseChildName / GRADE_LABELS 再 export |
| `ScheduleGrid` | components/shift/ScheduleGrid.tsx | 利用予定グリッド（児童×日）。月ステッパー + 事業所フィルタ。admin/manager 共通、scope prop |
| `ScheduleCellEditor` | components/shift/ScheduleCellEditor.tsx | セル編集ダイアログ（利用/迎え/送り/エリア） |
| `ReorderButtons` | components/admin/ReorderButtons.tsx | 並び替え（↑↓）。対応テーブル: compliance_documents/trainings/announcements/manuals（sort_order）+ **children**（display_order） |

---

## 14. サイドバー2モード構成（admin / manager）

admin / manager レイアウトは **社員モード** と **シフトモード** の 2 モードを持ち、右下フローティングボタンで切替。

### モード判定ロジック
- `localStorage['admin-mode']` / `localStorage['mgr-mode']` に `'staff'` / `'shift'` を永続化
- URL prefix で強制判定:
  - admin: `/admin/children/*`, `/admin/shifts/*`（dashboard/schedule/transport）→ shift
  - admin: `/admin/employees/*`, `/documents/*`, `/compliance/*`, `/trainings/*`, `/announcements/*`, `/manuals/*`, `/team-diagnosis/*`, `/settings/*`, `/dashboard` → staff
  - mgr: 同様パターン
  - **共有URL**（`/admin/shifts`, `/admin/requests`, `/mgr/shifts`, `/mgr/requests`）はモード据え置き（localStorage値を採用）

### admin 社員モード navItems
- ダッシュボード (`/admin/dashboard`) / 社員管理 / 書類テンプレ / 遵守事項 / 研修 / お知らせ / 業務マニュアル / チーム診断 / 設定
- ※ シフト表・休み希望はシフトモードからのみアクセス（社員モードからは除外）

### admin シフトモード navItems
- ダッシュボード (`/admin/shifts/dashboard`) / 利用予定 / シフト表 / 送迎表 / 休み希望 / **⚙️ シフト設定アコーディオン**（事業所設定 / 職員管理 / 児童管理）
- 作業順序に沿った並び（shift-puzzle と一致）

### mgr 社員モード navItems
- ダッシュボード / 部下管理 / 遵守事項 / 研修 / お知らせ / 業務マニュアル
- ※ シフト表・休み希望はシフトモードからのみアクセス

### mgr シフトモード navItems
- ダッシュボード (`/mgr/shifts/dashboard`) / 利用予定 / シフト表 / 送迎表 / 休み希望 / **⚙️ シフト設定アコーディオン**（事業所設定 / 職員管理 / 児童管理）

### employee タブ（layout 上部）
- ホーム / 基本情報 / 自己紹介 / 書類 / 遵守事項 / 研修 / お知らせ / 業務マニュアル / **休み希望**（新規追加）

### シフト系新規ページ（プレースホルダで導線のみ用意済）
- admin: `/admin/children`, `/admin/shifts`, `/admin/shifts/dashboard`, `/admin/shifts/schedule`, `/admin/shifts/transport`, `/admin/requests`
- mgr: `/mgr/children`, `/mgr/shifts`, `/mgr/shifts/dashboard`, `/mgr/shifts/schedule`, `/mgr/shifts/transport`, `/mgr/requests`
- my: `/my/requests`, `/my/shifts`

### Breadcrumb ラベル追加
- `components/admin/Breadcrumb.tsx` の `LABELS` に上記 14 ルートを追記済

---

## 9. ヘルパー / ライブラリ

| 名前 | パス | 用途 |
|---|---|---|
| `nextSortOrder` | lib/sort-helpers.ts | MAX(sort_order)+1 算出（カラム未存在時 null） |
| `sanitizeFilename`, `buildStoragePath` | lib/upload-helpers.ts | 日本語ファイル名対応 + Storage パス生成 |
| `enqueueNotification` | lib/notifications/queue.ts | 通知キュー |
| `createClient` (browser/server) | lib/supabase/client.ts, server.ts | Supabase クライアント |

---

## 10. APIルート一覧

| ルート | メソッド | ロール要件 | 備考 |
|---|---|---|---|
| `/api/auth/register` | POST | 公開 | テナント作成 + admin社員 |
| `/api/categories` | GET/POST/PATCH | GET:全/書込:admin,manager | type=compliance/training/announcement/manual |
| `/api/employees/invite` | POST | admin | 招待メール |
| `/api/employees/resend-invite` | POST | admin | - |
| `/api/employees/upload-image` | POST | admin | - |
| `/api/admin/send-reminder` | POST | admin | リマインダーメール |
| `/api/documents/upload-pdf` | POST | admin | テンプレPDF |
| `/api/documents/save-placements` | POST | admin | タグ配置 |
| `/api/documents/generate-pdf` | POST | - | 差し込み生成 |
| `/api/documents/bulk-pdf-zip` | POST | - | 一括ZIP |
| `/api/documents/bulk-pdf-zip-employee` | POST | admin | - |
| `/api/custom-fields` | CRUD | admin | - |
| `/api/field-visibility` | POST | admin | - |
| `/api/ai/{personality,strengths,culture-fit,team-compat}` | POST | - | AI 診断 |
| `/api/notifications/enqueue` | POST | - | 通知投入 |
| `/api/notifications/cancel` | POST | - | - |
| `/api/notifications/manager-action` | POST | manager | - |
| `/api/email/training-result` | POST | admin/manager | - |

**削除済**: `/api/stripe/*`, `/api/webhooks/stripe`, `/api/documents/copy-samples`（super_admin専用）

---

## 11. 連動ポイント早見表

| 変更箇所 | 確認必須ファイル |
|---|---|
| `lib/constants.ts` | middleware.ts + 全参照ファイル + 本ファイル §6 |
| `lib/types.ts` の型変更 | 該当型を使う全ファイル + 本ファイル §7 |
| `EMPLOYEE_ROLES` 変更 | 全APIロールチェック + middleware.ts + 本ファイル §1 |
| `publish_status` 変更 | shift/transport API + ShiftGrid + RLS + 本ファイル §2 |
| `facility_id` 追加 | 該当テーブル RLS + 本ファイル §3 |
| `categories.type` 追加 | api/categories VALID_TYPES + admin/categories タブ + admin/settings タブ + types.ts CategoryType |
| `content_blocks` 構造変更 | BlockEditor + BlockRenderer + types.ts ContentBlockJson |
| `sort_order` 関連 | nextSortOrder + ReorderButtons + 4テーブルの list query |
| Storage アップロード | sanitizeFilename + buildStoragePath（日本語ファイル名対応） |

---

## 12. CategoryType 'manual' 参照（業務マニュアル機能の連動）

| ファイル | 参照内容 |
|---|---|
| lib/types.ts:326 | `CategoryType` union に 'manual' |
| app/api/categories/route.ts:5 | VALID_TYPES に 'manual' |
| app/(admin)/admin/categories/page.tsx | TABS に '業務マニュアル' |
| app/(admin)/admin/settings/page.tsx | カテゴリ管理タブに '業務マニュアル' |
| app/(admin)/admin/manuals/page.tsx | カテゴリフェッチ `?type=manual` |
| app/(manager)/mgr/manuals/page.tsx | 同上 |
| app/(employee)/my/manuals/page.tsx | 同上 |
| supabase/migrations/091_manuals.sql | categories.type CHECK 制約に 'manual' |

---

## 13. ContentBlock 参照（ブロックエディタ連動）

| ファイル | 参照内容 |
|---|---|
| lib/types.ts | `ContentBlockJson` union 定義 |
| components/admin/BlockEditor.tsx | `ContentBlock` 型 + 編集UI |
| components/admin/BlockRenderer.tsx | 表示 + YouTube/Drive 埋込 URL 変換 |
| app/(admin)/admin/{compliance,trainings,announcements,manuals}/page.tsx | BlockEditor 使用、`content_blocks` に保存 |
| app/(employee)/my/{compliance,trainings,announcements,manuals}/page.tsx | BlockRenderer 使用、`content_blocks` 表示 |
| supabase/migrations/093_content_blocks.sql | 4テーブルに content_blocks jsonb |
| app/(manager)/mgr/{compliance,trainings,announcements,manuals}/page.tsx | BlockEditor 適用済（案B: target_type='facility' + 自担当facility、admin と機能同等） |

### 旧データ互換（重要）
- **compliance**: 既存の `content`（プレーンテキスト）しか持たないドキュメントを編集する際、`openEdit` で `content_blocks` が空なら `[{type:'text', value: content}]` として seed。保存時に `content_blocks` に取り込まれる。
  - 適用箇所: `app/(admin)/admin/compliance/page.tsx` `openEdit()`, `app/(manager)/mgr/compliance/page.tsx` `openEdit()`
