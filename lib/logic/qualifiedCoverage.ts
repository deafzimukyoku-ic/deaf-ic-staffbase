/**
 * 有資格者カウント + 提供時間カバレッジ + 余力（追加要員）チェック
 *
 * VBA 版のロジック移植（放課後等デイサービス想定、児童10人以内 小規模）:
 *   - 有資格者カウント: その日のコアタイムに重なる有資格者数
 *   - 提供時間: コアタイムを 30分刻みで走査、常時2名以上か
 *   - 余力: 全日カバー職員数に応じた 3名重複時間の確保判定
 *   - 児童10人超の日は個別判定をスキップし "要確認" 返す
 *
 * 移植元: diletto-shift-maker/src/lib/logic/qualifiedCoverage.ts
 * 機械的変換: shifts[].staff_id → shifts[].employee_id（呼び出し側で employee_id を渡す前提）
 *            ただし内部では staff_id 名で受け取る（後方互換）
 */

/* migration 116 で facility_shift_settings.core_start_time / core_end_time を導入。
   呼び出し側で設定値を渡す。未指定時は従来通り 10:30〜16:30 をフォールバックで使用。 */
const DEFAULT_CORE_START_MIN = 10 * 60 + 30; /* 10:30 */
const DEFAULT_CORE_END_MIN = 16 * 60 + 30; /* 16:30 */
const INTERVAL_MIN = 30;
const MIN_STAFF = 2;
const SMALL_SCALE_THRESHOLD = 10;

interface ShiftInterval {
  startMin: number;
  endMin: number;
  isQualified: boolean;
}

export interface CoverageResult {
  qualifiedCount: number;
  /** コアタイム中の最小人数。2名未満の瞬間があれば "不足" */
  minCoverage: number | '不足';
  /** 3名重複時間チェック。小規模日のみ意味あり、大規模日は "要確認"（従来仕様の互換用、新サイドバーでは未使用） */
  additional: 'OK' | '不足' | '要確認';
  childrenCount: number;
  scale: 'small' | 'large';
  /** コアタイムに重なる出勤者数（有資格者だけでなく全職員）。新サイドバーの「余力」分母用 */
  coreStaffCount: number;
}

/** "HH:MM" or "HH:MM:SS" を 分（分単位 since midnight）に */
export function parseTimeToMin(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * 指定日の有資格者カウント + 提供時間 + 余力を算出。
 * shifts[].staff_id は呼び出し側で employee.id を渡す（deaf-ic 規約）。
 *
 * coreStartTime/coreEndTime は migration 116 の facility_shift_settings 由来。
 * 未指定時は 10:30〜16:30 をフォールバック。
 */
export function calculateCoverage(params: {
  date: string;
  shifts: Array<{
    staff_id: string;
    date: string;
    start_time: string | null;
    end_time: string | null;
    assignment_type: 'normal' | 'public_holiday' | 'paid_leave' | 'off';
  }>;
  staffQualifiedMap: Map<string, boolean>;
  scheduleCount: number;
  coreStartTime?: string | null;
  coreEndTime?: string | null;
}): CoverageResult {
  const { date, shifts, staffQualifiedMap, scheduleCount } = params;
  const CORE_START_MIN = parseTimeToMin(params.coreStartTime ?? null) ?? DEFAULT_CORE_START_MIN;
  const CORE_END_MIN = parseTimeToMin(params.coreEndTime ?? null) ?? DEFAULT_CORE_END_MIN;

  /* normal 以外（休み・公休・有給）は除外 */
  const intervals: ShiftInterval[] = [];
  for (const s of shifts) {
    if (s.date !== date) continue;
    if (s.assignment_type !== 'normal') continue;
    const start = parseTimeToMin(s.start_time);
    const end = parseTimeToMin(s.end_time);
    if (start === null || end === null || end <= start) continue;
    intervals.push({
      startMin: start,
      endMin: end,
      isQualified: staffQualifiedMap.get(s.staff_id) ?? false,
    });
  }

  const scale: 'small' | 'large' = scheduleCount > SMALL_SCALE_THRESHOLD ? 'large' : 'small';

  /* 1. 有資格者カウント: コアタイムと重なる有資格者シフト数 */
  const qualifiedCount = intervals.filter(
    (iv) => iv.isQualified && iv.startMin < CORE_END_MIN && iv.endMin > CORE_START_MIN
  ).length;

  /* 2. 提供時間（最小2名）: 30分刻み走査 */
  let minCoverage: number | '不足' = Number.POSITIVE_INFINITY;
  for (let t = CORE_START_MIN; t < CORE_END_MIN; t += INTERVAL_MIN) {
    const slotEnd = t + INTERVAL_MIN;
    let cnt = 0;
    for (const iv of intervals) {
      if (iv.startMin < slotEnd && iv.endMin > t) cnt++;
    }
    if (cnt < MIN_STAFF) {
      minCoverage = '不足';
      break;
    }
    if (cnt < (minCoverage as number)) minCoverage = cnt;
  }
  if (minCoverage === Number.POSITIVE_INFINITY) minCoverage = 0;

  /* 3. 余力（3名重複時間）: 小規模日のみ。新サイドバーでは未使用だが互換のため算出は残す */
  let additional: CoverageResult['additional'];
  if (scale === 'large') {
    additional = '要確認';
  } else {
    additional = evaluateAdditional(intervals, CORE_START_MIN, CORE_END_MIN);
  }

  /* 4. コアタイムに重なる全職員数（有資格者かどうかに関係なく）。新サイドバー余力の分母用 */
  const coreStaffCount = intervals.filter(
    (iv) => iv.startMin < CORE_END_MIN && iv.endMin > CORE_START_MIN
  ).length;

  return {
    qualifiedCount,
    minCoverage,
    additional,
    childrenCount: scheduleCount,
    scale,
    coreStaffCount,
  };
}

function countFullCover(intervals: ShiftInterval[], coreStart: number, coreEnd: number): number {
  return intervals.filter((iv) => iv.startMin <= coreStart && iv.endMin >= coreEnd).length;
}

function hasTripleOverlap(
  intervals: ShiftInterval[],
  neededMinutes: number,
  coreStart: number,
  coreEnd: number,
): boolean {
  let consec = 0;
  for (let t = coreStart; t < coreEnd; t++) {
    let cnt = 0;
    for (const iv of intervals) {
      if (iv.startMin <= t && iv.endMin > t) cnt++;
    }
    if (cnt >= 3) {
      consec++;
      if (consec >= neededMinutes) return true;
    } else {
      consec = 0;
    }
  }
  return false;
}

function evaluateAdditional(intervals: ShiftInterval[], coreStart: number, coreEnd: number): 'OK' | '不足' {
  const fullCnt = countFullCover(intervals, coreStart, coreEnd);
  let neededHours: number;
  if (fullCnt >= 2) neededHours = 2;
  else if (fullCnt === 1) neededHours = 1;
  else return '不足';
  return hasTripleOverlap(intervals, neededHours * 60, coreStart, coreEnd) ? 'OK' : '不足';
}
