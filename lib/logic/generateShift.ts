/**
 * シフト半自動生成ロジック（ルールベース）
 *
 * 移植元: diletto-shift-maker/src/lib/logic/generateShift.ts
 * 機械的変換: staff_id → employee_id, tenant_id → tenant_id + facility_id, StaffRow → StaffRow(deaf-ic 版)
 *
 * ルール（CLAUDE.md §10 準拠）:
 * 1. 職員の休み希望を反映（希望休・有給・出勤可否を割り当て）
 * 2. 利用人数に応じた最低出勤人数を確保（ceil(利用人数/2)、最低3名）
 * 3. 有資格者が規定数以上出勤するよう確保
 * 4. 生成結果は publish_status='draft' / is_confirmed=false で保存（自動確定禁止）
 */
import type {
  StaffRow,
  ShiftAssignmentRow,
  ShiftRequestRow,
  ScheduleEntryRow,
  ShiftAssignmentType,
} from '@/lib/types';
import { DEFAULT_MIN_QUALIFIED_STAFF } from '@/lib/constants';
import { isAttended } from '@/lib/logic/attendance';

interface GenerateShiftInput {
  tenantId: string;
  facilityId: string;
  year: number;
  month: number;
  staff: StaffRow[];
  shiftRequests: ShiftRequestRow[];
  scheduleEntries: ScheduleEntryRow[];
  minQualifiedStaff?: number;
}

export interface ShiftWarning {
  date: string;
  type: 'understaffed' | 'no_qualified' | 'overworked';
  message: string;
}

interface GenerateShiftResult {
  assignments: Omit<ShiftAssignmentRow, 'id' | 'created_at'>[];
  warnings: ShiftWarning[];
}

export function generateShiftAssignments(
  input: GenerateShiftInput
): GenerateShiftResult {
  const {
    tenantId,
    facilityId,
    year,
    month,
    staff,
    shiftRequests,
    scheduleEntries,
    minQualifiedStaff = DEFAULT_MIN_QUALIFIED_STAFF,
  } = input;

  const assignments: Omit<ShiftAssignmentRow, 'id' | 'created_at'>[] = [];
  const warnings: ShiftWarning[] = [];

  const daysInMonth = new Date(year, month, 0).getDate();

  // 休み希望をマップ化: employee_id → { requestedOffs, paidLeaves, fullAvails, amOffs, pmOffs }
  // requestedOffs = 希望休（社員が出した休み希望。migration 157 で public_holiday から改名）
  // fullAvails = 一日出勤可 / amOffs = AM休 / pmOffs = PM休
  //   一日出勤可を1つでも出した人は opt-in（申告日のみ出勤・空白は休み）になる。常勤・パート問わず。
  //   旧実装は full_day_available/am_off/pm_off を availableDays に丸めて半休を消していた。
  //   migration 218 で shift_assignments に am_off/pm_off を追加し、ここで分離して対称化する。
  const requestMap = new Map<
    string,
    {
      requestedOffs: Set<string>;
      paidLeaves: Set<string>;
      fullAvails: Set<string>;
      amOffs: Set<string>;
      pmOffs: Set<string>;
    }
  >();

  for (const req of shiftRequests) {
    if (!requestMap.has(req.employee_id)) {
      requestMap.set(req.employee_id, {
        requestedOffs: new Set(),
        paidLeaves: new Set(),
        fullAvails: new Set(),
        amOffs: new Set(),
        pmOffs: new Set(),
      });
    }
    const entry = requestMap.get(req.employee_id)!;
    for (const d of req.dates) {
      if (req.request_type === 'requested_off') entry.requestedOffs.add(d);
      else if (req.request_type === 'paid_leave') entry.paidLeaves.add(d);
      else if (req.request_type === 'full_day_available') entry.fullAvails.add(d);
      else if (req.request_type === 'am_off') entry.amOffs.add(d);
      else if (req.request_type === 'pm_off') entry.pmOffs.add(d);
    }
  }

  // 日ごとの利用人数を集計
  // 判定は lib/logic/attendance.ts の isAttended (時間あり ∧ ¬waitlist) に一元化。
  // 時間 NULL の planned エントリ（attendance_status だけ作られた空セル）はカウントしない。
  const dailyChildCount = new Map<string, number>();
  for (const entry of scheduleEntries) {
    if (!isAttended(entry)) continue;
    const count = dailyChildCount.get(entry.date) || 0;
    dailyChildCount.set(entry.date, count + 1);
  }

  // 各日のシフトを生成
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(year, month - 1, d).getDay();

    // 利用人数から最低出勤人数を算出
    const childCount = dailyChildCount.get(dateStr) || 0;
    const minStaff = Math.max(3, Math.ceil(childCount / 2));

    let assignedCount = 0;
    let qualifiedCount = 0;

    for (const s of staff) {
      const requests = requestMap.get(s.id);
      let assignmentType: ShiftAssignmentType = 'normal';

      const hasAm = requests?.amOffs.has(dateStr) ?? false;
      const hasPm = requests?.pmOffs.has(dateStr) ?? false;
      /* opt-in 判定: 一日出勤可(full_day_available)を1つでも出した人は
         「申告した日だけ出勤、未記入の空白日は休み」になる（常勤・パート問わず）。 */
      const optInAvailability = (requests?.fullAvails.size ?? 0) > 0;

      // 優先順位: 終日休(希望休>有給) > 半休(AM休/PM休) > 一日出勤可 > 空白(opt-in/パート/常勤日曜は休み)。
      // 公休（public_holiday）は管理者がシフト作成画面で明示マークするもので、ここでは生成しない。
      if (requests?.requestedOffs.has(dateStr)) {
        assignmentType = 'requested_off';
      } else if (requests?.paidLeaves.has(dateStr)) {
        assignmentType = 'paid_leave';
      } else if (hasAm && hasPm) {
        // 同日に AM休 と PM休 が両方 = 矛盾 → 終日休(希望休)に丸める
        assignmentType = 'requested_off';
      } else if (hasAm) {
        assignmentType = 'am_off';
      } else if (hasPm) {
        assignmentType = 'pm_off';
      } else if (requests?.fullAvails.has(dateStr)) {
        // 一日出勤可を申告した日は出勤
        assignmentType = 'normal';
      } else if (optInAvailability || s.employment_type === 'part_time' || dow === 0) {
        // 空白日: opt-in の人 / パート / 常勤の日曜 は休み
        assignmentType = 'off';
      }
      // 上記いずれにも該当しない（常勤・一日出勤可なし・平日）は初期値 normal のまま

      // 勤務時間区間: normal=職員デフォルト / pm_off=午前[出勤,13:30] / am_off=午後[14:30,退勤]
      let startTime: string | null = null;
      let endTime: string | null = null;
      if (assignmentType === 'normal') {
        startTime = s.default_start_time || '09:00';
        endTime = s.default_end_time || '17:00';
      } else if (assignmentType === 'pm_off') {
        startTime = s.default_start_time || '09:30';
        endTime = '13:30';
      } else if (assignmentType === 'am_off') {
        startTime = '14:30';
        endTime = s.default_end_time || '18:00';
      }

      // 出勤系(normal/am_off/pm_off)はカバレッジ用の在席として数える（精密判定は qualifiedCoverage 側）
      const isWorking =
        assignmentType === 'normal' || assignmentType === 'am_off' || assignmentType === 'pm_off';

      if (isWorking) {
        assignedCount++;
        if (s.is_qualified) qualifiedCount++;
      }

      assignments.push({
        tenant_id: tenantId,
        facility_id: facilityId,
        employee_id: s.id,
        date: dateStr,
        start_time: startTime,
        end_time: endTime,
        assignment_type: assignmentType,
        is_confirmed: false,
        publish_status: 'draft',
        segment_order: 0,
        note: null,
      });
    }

    // 警告チェック
    if (childCount > 0 && assignedCount < minStaff) {
      warnings.push({
        date: dateStr,
        type: 'understaffed',
        message: `人員不足: 出勤${assignedCount}名 / 必要${minStaff}名（利用児童${childCount}名）`,
      });
    }

    if (childCount > 0 && qualifiedCount < minQualifiedStaff) {
      warnings.push({
        date: dateStr,
        type: 'no_qualified',
        message: `有資格者不足: ${qualifiedCount}名 / 必要${minQualifiedStaff}名`,
      });
    }
  }

  return { assignments, warnings };
}
