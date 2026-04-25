import type {
  StaffRow,
  ShiftAssignmentRow,
  ScheduleEntryRow,
  TransportAssignmentRow,
  ChildRow,
  AreaLabel,
  ChildAreaEligibleStaffRow,
} from '@/lib/types';
import {
  DEFAULT_TRANSPORT_MIN_END_TIME,
  AUTO_ASSIGN_STAFF_COUNT,
  DEFAULT_PICKUP_COOLDOWN_MINUTES,
  TRANSPORT_TRIP_GAP_MINUTES,
} from '@/lib/constants';
import { resolveEntryTransportSpec } from '@/lib/shift-logic/resolveTransportSpec';

/**
 * 送迎担当仮割り当てロジック（ルールベース）— shift-puzzle Phase 60 を忠実移植。
 * 元: diletto-shift-maker/src/lib/logic/generateTransport.ts
 *
 * deaf-ic 適合のための差分:
 *  - tenant_id 単独 → tenant_id + facility_id 二重スコープ
 *  - StaffRow.staff_id → employee_id（deaf-ic は StaffRow.id を使用、同じ）
 *  - ShiftAssignmentRow.staff_id → ShiftAssignmentRow.employee_id
 *  - ChildAreaEligibleStaffRow.staff_id → employee_id
 *  - 出力 pickup_staff_ids → pickup_employee_ids / dropoff_employee_ids（migration 112）
 *
 * 割り当て優先ルール（CLAUDE.md §10 準拠、この順番で評価）:
 * 1. その日に出勤している職員のみ候補
 * 2. 送迎時間が職員の勤務時間内に収まること
 * 3. 送迎エリアが職員の対応エリアと一致すること
 * 4. 同一エリア・同一方向で、前便との間隔が 30 分未満の場合はグルーピング
 *    → 同グループ内の児童は同じ職員が担当（同便＝同一トリップ扱い）
 *    → 30 分以上空いたら別便扱いで新規に職員を選定
 * 5. 1日の送迎回数（トリップ単位）が均等になるよう分散
 *
 * 制約:
 * - 1回の送迎につき担当者は最大2名まで
 * - 条件を満たす職員が存在しない場合: is_unassigned: true
 * - 生成結果は publish_status='draft', is_confirmed: false（自動確定禁止）
 *
 * 関数シグネチャは変更禁止（CLAUDE.md §12）
 */

type GenerateTransportInput = {
  tenantId: string;
  facilityId: string;
  date: string;
  scheduleEntries: ScheduleEntryRow[];
  staff: StaffRow[];
  shiftAssignments: ShiftAssignmentRow[];
  /** Phase 26: この時刻以降に退勤する職員のみ候補。"HH:MM"。省略時 "16:31" */
  minEndTime?: string;
  /** マーク解決に使う児童情報 */
  children?: ChildRow[];
  /** facility pickup_areas。マーク → time/address 解決に使用。 */
  pickupAreas?: AreaLabel[];
  /** facility dropoff_areas。マーク → time/address 解決に使用。 */
  dropoffAreas?: AreaLabel[];
  /** Phase 28: 迎え連続担当禁止時間（分）。ある職員が pickup 担当後、この分数内は同職員を候補から除外。
      未指定はデフォルト 45 分。送り側には適用しない。 */
  pickupCooldownMinutes?: number;
  /** Phase 60: 児童専用エリアごとの担当可能職員（多対多）。
      child-specific な areaId（= children.custom_*_areas 内の id）の場合のみこのテーブルを参照。
      未指定や空配列なら child-specific エリアは自動割り当て対象外。 */
  childAreaEligibleStaff?: ChildAreaEligibleStaffRow[];
};

type GenerateTransportResult = {
  assignments: Omit<TransportAssignmentRow, 'id' | 'created_at'>[];
  unassignedCount: number;
};

export function generateTransportAssignments(
  input: GenerateTransportInput
): GenerateTransportResult {
  const { tenantId, facilityId, date, scheduleEntries, staff, shiftAssignments } = input;
  /* Phase 47 (②): minEndTime によるグローバルな退勤時刻フィルタは廃止。
     旧仕様だと「16:30 までしか勤務しない職員」がお迎え便にも出てこないバグがあった。
     代わりに送り便側だけで「退勤時刻 > 便発時刻」（厳密）を後段で判定する。
     props は API 互換のため残置。 */
  void input.minEndTime;
  void DEFAULT_TRANSPORT_MIN_END_TIME;
  const children = input.children ?? [];
  const pickupAreas = input.pickupAreas ?? [];
  const dropoffAreas = input.dropoffAreas ?? [];
  const pickupCooldownMin = input.pickupCooldownMinutes ?? DEFAULT_PICKUP_COOLDOWN_MINUTES;
  const childById = new Map(children.map((c) => [c.id, c]));

  /* Phase 60: tenant area id の集合と、child-specific area ごとの担当可能職員 map を作る。
     - tenant areaId → staff.transport_areas で判定（従来通り）
     - child-specific areaId → eligibleStaffByAreaDir で判定（このテーブルにある職員のみ OK） */
  const tenantAreaIds = new Set<string>([
    ...pickupAreas.map((a) => a.id),
    ...dropoffAreas.map((a) => a.id),
  ]);
  const eligibleStaffByAreaDir = new Map<string, Set<string>>();
  for (const r of input.childAreaEligibleStaff ?? []) {
    const k = `${r.area_id}|${r.direction}`;
    if (!eligibleStaffByAreaDir.has(k)) eligibleStaffByAreaDir.set(k, new Set());
    eligibleStaffByAreaDir.get(k)!.add(r.employee_id);
  }

  /* ① 出勤している職員のみ抽出（end_time が記録されている職員）。
     Phase 50: 分割シフト対応。同一職員に複数セグメントがある場合、
     少なくとも 1 つに end_time が入っていれば「出勤している」とみなす。
     退勤時刻ガードは送り便のみ selectStaff 内で適用する。 */
  const workingStaff = staff.filter((s) =>
    shiftAssignments.some(
      (sa) =>
        sa.employee_id === s.id &&
        sa.date === date &&
        sa.assignment_type === 'normal' &&
        !!sa.end_time
    )
  );

  /* 職員ごとの送迎担当回数（均等分散用、トリップ単位）。
     同一グループ(同エリア・同時間帯)の児童は同じ職員が担当するため、
     グループ新規作成時のみカウントを増やし、再利用時は増やさない。 */
  const staffAssignCount = new Map<string, number>();
  workingStaff.forEach((s) => staffAssignCount.set(s.id, 0));
  /* Phase 28: 職員ごとに「最後に迎を担当した pickup_time（分）」を記録し、
     クールダウン内の再アサインを防ぐ。送り側には適用しない。 */
  const lastPickupMinByStaff = new Map<string, number>();

  /* グルーピング記録: 同一 (direction, areaId) で、グループ内の既存便との時刻差が
     SEPARATE_TRIP_GAP_MINUTES 未満なら「同便」として職員を再利用する。
     30 分以上空いた場合は「別便」として新規にグループ（新規職員選定）を作る。
     運用イメージ: 同一スタッフが「行って帰ってまた行く」のを別便としてカウントするため、
     前便の時刻から 30 分以上経過していれば別トリップとして扱う。
     CLAUDE.md §10 ルール #4 の実装。 */
  const SEPARATE_TRIP_GAP_MINUTES = TRANSPORT_TRIP_GAP_MINUTES;
  type GroupRecord = {
    direction: 'pickup' | 'dropoff';
    areaId: string;
    /** グループ内で最も新しい時刻（分）。次エントリとの差が <30 分なら同便。 */
    latestTimeMin: number;
    staff: StaffRow[];
  };
  const groupAssignments: GroupRecord[] = [];
  /** 既存グループの中で (direction, areaId) が一致し、時刻差が <30 分のものを返す。
      該当が複数ある場合は最も時刻が近い（最後に更新された）グループを返す。 */
  function findMatchingGroup(
    direction: 'pickup' | 'dropoff',
    areaId: string | null,
    timeMin: number | null
  ): GroupRecord | null {
    if (!areaId || timeMin === null) return null;
    let best: GroupRecord | null = null;
    let bestDiff = SEPARATE_TRIP_GAP_MINUTES;
    for (const g of groupAssignments) {
      if (g.direction !== direction || g.areaId !== areaId) continue;
      const diff = Math.abs(g.latestTimeMin - timeMin);
      if (diff < bestDiff) {
        best = g;
        bestDiff = diff;
      }
    }
    return best;
  }

  const assignments: Omit<TransportAssignmentRow, 'id' | 'created_at'>[] = [];
  let unassignedCount = 0;

  /* Phase 28: 迎のクールダウンを時系列順に正しく評価するため、pickup_time 昇順で処理。
     送りは処理順に依存しないが、同一配列で扱ってまとめて assignments を push する。 */
  const dateEntries = scheduleEntries
    .filter((e) => e.date === date && e.facility_id === facilityId)
    .slice()
    .sort((a, b) => {
      const ap = normalizeTimeMinutes(a.pickup_time) ?? Number.MAX_SAFE_INTEGER;
      const bp = normalizeTimeMinutes(b.pickup_time) ?? Number.MAX_SAFE_INTEGER;
      return ap - bp;
    });

  /* 各利用予定に対して担当を割り当て */
  for (const entry of dateEntries) {
    /* マーク × facility/児童専用エリアで areaLabel / time を解決 */
    const spec = resolveEntryTransportSpec(entry, {
      child: childById.get(entry.child_id),
      pickupAreas,
      dropoffAreas,
    });
    const pickupAreaId = spec.pickup.areaId;
    const dropoffAreaId = spec.dropoff.areaId;
    const pickupTime = spec.pickup.time;
    const dropoffTime = spec.dropoff.time;

    /* Phase 26: 保護者送迎（method='self'）は担当不要 */
    const pickupNeedsStaff = entry.pickup_method !== 'self';
    const dropoffNeedsStaff = entry.dropoff_method !== 'self';

    /* エリアがマークで解決できない児童は自動割当しない。
       unassigned のまま残して、送迎表で手動割当させる（ユーザー運用）。 */
    const pickupResolvable = pickupNeedsStaff && !!pickupAreaId;
    const dropoffResolvable = dropoffNeedsStaff && !!dropoffAreaId;

    /* 迎え担当を選定（保護者送迎なら空 / エリア未解決なら空）。
       ルール #4: 同エリア・前便との間隔<30分なら同便扱いで職員を再利用。 */
    const pickupTimeMin = normalizeTimeMinutes(pickupTime);
    let pickupStaff: StaffRow[] = [];
    if (pickupResolvable) {
      const matched = findMatchingGroup('pickup', pickupAreaId, pickupTimeMin);
      if (matched) {
        pickupStaff = matched.staff;
        /* グループの最新時刻を更新（次エントリとの間隔判定用） */
        if (pickupTimeMin !== null && pickupTimeMin > matched.latestTimeMin) {
          matched.latestTimeMin = pickupTimeMin;
        }
      } else {
        pickupStaff = selectStaff({
          workingStaff,
          shiftAssignments,
          date,
          time: pickupTime,
          areaId: pickupAreaId,
          direction: 'pickup',
          staffAssignCount,
          /* Phase 28: 自動割当は 1 名固定。2 名目は手動で追加する運用に統一。 */
          maxStaff: AUTO_ASSIGN_STAFF_COUNT,
          /* Phase 28: 迎のクールダウン適用 */
          cooldownContext: {
            lastPickupMinByStaff,
            cooldownMinutes: pickupCooldownMin,
          },
          tenantAreaIds,
          eligibleStaffByAreaDir,
        });
        if (pickupStaff.length > 0 && pickupAreaId && pickupTimeMin !== null) {
          groupAssignments.push({
            direction: 'pickup',
            areaId: pickupAreaId,
            latestTimeMin: pickupTimeMin,
            staff: pickupStaff,
          });
        }
      }
    }

    /* 送り担当を選定（保護者送迎なら空 / エリア未解決なら空）。
       ルール #4: 同エリア・前便との間隔<30分なら同便扱いで職員を再利用。 */
    const dropoffTimeMin = normalizeTimeMinutes(dropoffTime);
    let dropoffStaff: StaffRow[] = [];
    if (dropoffResolvable) {
      const matched = findMatchingGroup('dropoff', dropoffAreaId, dropoffTimeMin);
      if (matched) {
        dropoffStaff = matched.staff;
        if (dropoffTimeMin !== null && dropoffTimeMin > matched.latestTimeMin) {
          matched.latestTimeMin = dropoffTimeMin;
        }
      } else {
        dropoffStaff = selectStaff({
          workingStaff,
          shiftAssignments,
          date,
          time: dropoffTime,
          areaId: dropoffAreaId,
          direction: 'dropoff',
          staffAssignCount,
          maxStaff: AUTO_ASSIGN_STAFF_COUNT,
          /* 送りにはクールダウンを適用しない */
          tenantAreaIds,
          eligibleStaffByAreaDir,
        });
        if (dropoffStaff.length > 0 && dropoffAreaId && dropoffTimeMin !== null) {
          groupAssignments.push({
            direction: 'dropoff',
            areaId: dropoffAreaId,
            latestTimeMin: dropoffTimeMin,
            staff: dropoffStaff,
          });
        }
      }
    }

    /* Phase 28: 迎を割り当てた職員について pickup_time を記録（次のクールダウン判定用） */
    const pickupMin = normalizeTimeMinutes(pickupTime);
    if (pickupMin !== null) {
      for (const s of pickupStaff) {
        const prev = lastPickupMinByStaff.get(s.id);
        if (prev === undefined || pickupMin > prev) {
          lastPickupMinByStaff.set(s.id, pickupMin);
        }
      }
    }

    /* is_unassigned: 必要な側が空のときだけ true。
       pickupResolvable=false でも pickupNeedsStaff=true なら unassigned 扱い。 */
    const pickupEmpty = pickupNeedsStaff && pickupStaff.length === 0;
    const dropoffEmpty = dropoffNeedsStaff && dropoffStaff.length === 0;
    const isUnassigned = pickupEmpty || dropoffEmpty;
    if (isUnassigned) unassignedCount++;

    assignments.push({
      tenant_id: tenantId,
      facility_id: facilityId,
      schedule_entry_id: entry.id,
      pickup_employee_ids: pickupStaff.map((s) => s.id),
      dropoff_employee_ids: dropoffStaff.map((s) => s.id),
      is_confirmed: false,
      /* Phase 45: 自動生成は常に lock=false で出力（既存ロックは API 側でスキップ済） */
      is_locked: false,
      is_unassigned: isUnassigned,
      publish_status: 'draft',
    });
  }

  return { assignments, unassignedCount };
}

/* 担当職員の選定 */
function selectStaff({
  workingStaff,
  shiftAssignments,
  date,
  time,
  areaId,
  direction,
  staffAssignCount,
  maxStaff,
  cooldownContext,
  tenantAreaIds,
  eligibleStaffByAreaDir,
}: {
  workingStaff: StaffRow[];
  shiftAssignments: ShiftAssignmentRow[];
  date: string;
  time: string | null;
  /** Phase 30: AreaLabel.id（職員 transport_areas との比較キー） */
  areaId: string | null;
  /** Phase 27-D: 迎=pickup, 送=dropoff。エリアフィルタに使う職員側カラムを切替 */
  direction: 'pickup' | 'dropoff';
  staffAssignCount: Map<string, number>;
  maxStaff: number;
  /** Phase 28: 迎のみ渡す。直近 pickup_time（分）を職員ごとに記録し、cooldown 内を候補から除外 */
  cooldownContext?: {
    lastPickupMinByStaff: Map<string, number>;
    cooldownMinutes: number;
  };
  /** Phase 60: テナント共通 AreaLabel.id の集合。これに含まれない areaId は child-specific として扱う */
  tenantAreaIds: Set<string>;
  /** Phase 60: child-specific 用の担当可能職員 map。key=`${areaId}|${direction}` */
  eligibleStaffByAreaDir: Map<string, Set<string>>;
}): StaffRow[] {
  if (!time) return [];
  const timeMin = normalizeTimeMinutes(time);

  const candidates = workingStaff.filter((s) => {
    /* Phase 59: 自動割り当ては運転手のみ。
       is_driver=false の職員は自動選出対象外。付き添いは右スロットで手動追加する運用。 */
    if (!s.is_driver) return false;
    /* Phase 50: 分割シフト対応。同一 (employee, date) の全セグメントを集め、
       便時刻がいずれかのセグメントに収まるかで判定する。 */
    const segments = shiftAssignments.filter(
      (sa) =>
        sa.employee_id === s.id &&
        sa.date === date &&
        sa.assignment_type === 'normal' &&
        sa.start_time &&
        sa.end_time
    );
    if (segments.length === 0) return false;

    /* Phase 60: 迎/送 統一ルール。便時刻がセグメントに収まり、かつ 退勤 >= 便 + 30 分。
         - start <= t: まだ出勤していない職員は候補外
         - t + 30 <= end: 便後 30 分の往復/戻り時間を確保（迎でも必要）
       旧 Phase 47 の「送りだけ厳密 end>time」ガードはこの式に吸収された（>= はバッファ込み）。 */
    const TRANSPORT_BUFFER_MINUTES = 30;
    if (timeMin === null) return false;
    const coveringSegment = segments.find((seg) => {
      const sm = normalizeTimeMinutes(seg.start_time!);
      const em = normalizeTimeMinutes(seg.end_time!);
      if (sm === null || em === null) return false;
      return sm <= timeMin && timeMin + TRANSPORT_BUFFER_MINUTES <= em;
    });
    if (!coveringSegment) return false;

    /* ③ エリア一致（エリア指定がある場合）。
       Phase 60: 2 段階評価。
         - areaId が tenant 共通エリア → staff.pickup_transport_areas / dropoff_transport_areas で判定
         - areaId が child-specific → child_area_eligible_staff で判定
       Phase 30: 比較キーは AreaLabel.id（テナント設定上の uuid）。 */
    if (areaId) {
      if (tenantAreaIds.has(areaId)) {
        const directionAreas =
          direction === 'pickup' ? s.pickup_transport_areas : s.dropoff_transport_areas;
        const effective =
          (directionAreas && directionAreas.length > 0) ? directionAreas : [];
        if (!effective.includes(areaId)) return false;
      } else {
        /* child-specific エリア。担当可能職員が登録されていない or この職員が含まれなければ候補外。 */
        const set = eligibleStaffByAreaDir.get(`${areaId}|${direction}`);
        if (!set || !set.has(s.id)) return false;
      }
    }

    /* Phase 28: 迎のクールダウンチェック。直近 pickup_time + cooldown 以降でなければ候補外。 */
    if (cooldownContext && timeMin !== null) {
      const last = cooldownContext.lastPickupMinByStaff.get(s.id);
      if (last !== undefined && timeMin - last < cooldownContext.cooldownMinutes) {
        return false;
      }
    }

    return true;
  });

  /* ⑤ 送迎回数が少ない順にソート */
  candidates.sort((a, b) => {
    const countA = staffAssignCount.get(a.id) || 0;
    const countB = staffAssignCount.get(b.id) || 0;
    return countA - countB;
  });

  /* 最大人数まで選択 */
  const selected = candidates.slice(0, maxStaff);

  /* カウントを更新 */
  selected.forEach((s) => {
    staffAssignCount.set(s.id, (staffAssignCount.get(s.id) || 0) + 1);
  });

  return selected;
}

/** "HH:MM" or "HH:MM:SS" → 分数。null 可 */
function normalizeTimeMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
