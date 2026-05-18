'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { format, getDaysInMonth } from 'date-fns';
import { useTransportDate } from '@/lib/hooks/useTransportDate';
import { useShiftFacilityId } from '@/lib/shift-facility';
import { createClient } from '@/lib/supabase/client';
import TransportDayView from '@/components/shift/TransportDayViewFull';
import { buildPickerItems } from '@/components/shift/AddShiftStaffPicker';
import DateStepperFull from '@/components/shift/DateStepperFull';
import Button from '@/components/shift-compat/Button';
import Modal from '@/components/shift-compat/Modal';
import { resolveEntryTransportSpec } from '@/lib/shift-logic/resolveTransportSpec';
import { isAttended, isWaitlist } from '@/lib/logic/attendance';
import { replaceShiftDay, type ShiftSegmentInput } from '@/lib/api/shiftAssignments';
import { fetchFacilityMembers, type FacilityMemberRow } from '@/lib/multi-facility';
import {
  DEFAULT_TRANSPORT_MIN_END_TIME,
  DEFAULT_PICKUP_COOLDOWN_MINUTES,
  DEFAULT_TRANSPORT_COLUMN_ORDER,
  type TransportColumnKey,
} from '@/lib/constants';
import type {
  StaffRow,
  ChildRow,
  ScheduleEntryRow,
  ShiftAssignmentRow,
  TransportAssignmentRow,
  AreaLabel,
  ChildAreaEligibleStaffRow,
} from '@/lib/types';

/**
 * 送迎表ページ（deaf-ic 版）— shift-puzzle transport/page.tsx を忠実移植。
 *
 * 主な差分:
 * - tenant 単独 → tenant + facility 二重スコープ（useShiftFacilityId 経由でヘッダーから取得）
 * - 全 API 呼び出しを supabase client 直接 fetch に変更（RLS で権限制御）
 * - staff_id → employee_id 命名統一（migration 112 で配列カラムも employee_ids に）
 * - role: viewer/editor → employee/manager
 * - 自動生成のみ既存 /api/shifts/transport/generate（B-1）を使用
 * - 列順保存 → facility_shift_settings.transport_column_order を直接 update
 *   (172: 施設単位で全員に共通の並びを共有。ブラウザ/端末をまたいで揃う)
 *
 * ヤバいロジックは全て温存（pendingChanges localStorage / 同便マーク / 分割シフト / etc.）
 */

type Role = 'admin' | 'manager' | 'employee';

type UiTransportEntry = {
  scheduleEntryId: string;
  childId: string;
  childName: string;
  pickupTime: string | null;
  dropoffTime: string | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupAreaLabel: string | null;
  dropoffAreaLabel: string | null;
  pickupAreaId: string | null;
  dropoffAreaId: string | null;
  pickupStaffIds: string[];
  dropoffStaffIds: string[];
  isUnassigned: boolean;
  isConfirmed: boolean;
  pickupMethod: 'pickup' | 'self';
  dropoffMethod: 'dropoff' | 'self';
};

type PendingAssignment = {
  pickupStaffIds: string[];
  dropoffStaffIds: string[];
};

interface Props {
  /** 'admin' or 'manager'。employee は来ない想定 */
  role: 'admin' | 'manager';
}

export default function TransportFull({ role }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId] = useShiftFacilityId();

  const { year, month, date: selectedDate, setDate: setSelectedDate } = useTransportDate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryRow[]>([]);
  const [shiftAssignments, setShiftAssignments] = useState<ShiftAssignmentRow[]>([]);
  const [transportAssignments, setTransportAssignments] = useState<TransportAssignmentRow[]>([]);
  const [pickupAreas, setPickupAreas] = useState<AreaLabel[]>([]);
  const [dropoffAreas, setDropoffAreas] = useState<AreaLabel[]>([]);
  const [childAreaEligibleStaff, setChildAreaEligibleStaff] = useState<
    ChildAreaEligibleStaffRow[]
  >([]);
  const [transportMinEndTime, setTransportMinEndTime] = useState<string>(
    DEFAULT_TRANSPORT_MIN_END_TIME
  );
  const [pickupCooldownMinutes, setPickupCooldownMinutes] = useState<number>(
    DEFAULT_PICKUP_COOLDOWN_MINUTES
  );
  const [columnOrder, setColumnOrder] = useState<TransportColumnKey[]>(
    [...DEFAULT_TRANSPORT_COLUMN_ORDER]
  );
  /* tenant_id をクエリに使う */
  const [tenantId, setTenantId] = useState<string | null>(null);
  /* 自分のロール（props で受け取るが、念のため fetch でも検証） */
  const myRole: Role = role;

  const [addShiftModal, setAddShiftModal] = useState<{
    step: 'pick' | 'time';
    staffId: string;
    startTime: string;
    endTime: string;
    saving: boolean;
    errorMsg: string;
  } | null>(null);

  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingAssignment>>(new Map());
  const [saving, setSaving] = useState(false);

  const pendingStorageKey = `deaf-ic:transport:pending:${facilityId ?? 'na'}:${year}-${String(month).padStart(2, '0')}`;
  const restoredFromStorageRef = useRef(false);
  useEffect(() => {
    if (restoredFromStorageRef.current) return;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(pendingStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, PendingAssignment>;
        const restored = new Map<string, PendingAssignment>(Object.entries(parsed));
        if (restored.size > 0) setPendingChanges(restored);
      }
    } catch {
      /* 破損キャッシュは無視 */
    } finally {
      restoredFromStorageRef.current = true;
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [pendingStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!restoredFromStorageRef.current) return;
    try {
      if (pendingChanges.size === 0) {
        window.localStorage.removeItem(pendingStorageKey);
      } else {
        const obj: Record<string, PendingAssignment> = {};
        for (const [k, v] of pendingChanges.entries()) obj[k] = v;
        window.localStorage.setItem(pendingStorageKey, JSON.stringify(obj));
      }
    } catch {
      /* noop */
    }
  }, [pendingChanges, pendingStorageKey]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [toast, setToast] = useState<{ kind: 'success' | 'warning' | 'error'; message: string } | null>(
    null
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const daysInMonth = getDaysInMonth(new Date(year, month - 1));

  type DayState = { locked?: boolean; unassigned?: boolean; editing?: boolean };
  const dayStates = useMemo<Map<string, DayState>>(() => {
    const m = new Map<string, DayState>();
    const entryDateById = new Map<string, string>();
    for (const e of scheduleEntries) entryDateById.set(e.id, e.date);
    for (const t of transportAssignments) {
      const date = entryDateById.get(t.schedule_entry_id);
      if (!date) continue;
      const cur = m.get(date) ?? {};
      if (t.is_locked) cur.locked = true;
      if (t.is_unassigned) cur.unassigned = true;
      m.set(date, cur);
    }
    for (const entryId of pendingChanges.keys()) {
      const date = entryDateById.get(entryId);
      if (!date) continue;
      const cur = m.get(date) ?? {};
      cur.editing = true;
      m.set(date, cur);
    }
    return m;
  }, [scheduleEntries, transportAssignments, pendingChanges]);

  const workDays = useMemo(() => {
    const days: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      days.push(format(dateObj, 'yyyy-MM-dd'));
    }
    return days;
  }, [year, month, daysInMonth]);

  /* deaf-ic: 全データを supabase client 直接 fetch（RLS で facility 単位に絞られる） */
  const fetchAll = useCallback(async () => {
    if (!facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

      /* 自分の tenant_id 取得（毎回ではなく初回のみで十分だが、facility が変わった時の保険） */
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未認証');
      const { data: me } = await supabase
        .from('employees')
        .select('id, tenant_id, role')
        .eq('auth_user_id', user.id)
        .single();
      if (!me) throw new Error('社員情報が取得できません');
      setTenantId(me.tenant_id);

      // 職員一覧は SECURITY DEFINER RPC 経由で取得（migration 155）。
      // employees の RLS は manager / shift_manager に SELECT 権限を持たないため、
      // 直接 SELECT すると自分の行しか返らない。RPC で RLS バイパスして取得する。
      const allMembers = await fetchFacilityMembers(supabase, facilityId);
      const empRows = allMembers
        .filter((m) => m.status === 'active')
        .sort((a, b) => {
          const ao = a.shift_display_order ?? Number.MAX_SAFE_INTEGER;
          const bo = b.shift_display_order ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return a.last_name.localeCompare(b.last_name, 'ja');
        });

      const [
        childRes,
        entryRes,
        shiftRes,
        transportRes,
        settingsRes,
        eligRes,
      ] = await Promise.all([
        supabase.from('children').select('*').eq('facility_id', facilityId),
        supabase
          .from('schedule_entries')
          .select('*')
          .eq('facility_id', facilityId)
          .gte('date', from)
          .lte('date', to),
        supabase
          .from('shift_assignments')
          .select('*')
          .eq('facility_id', facilityId)
          .gte('date', from)
          .lte('date', to),
        supabase
          .from('transport_assignments')
          .select('*')
          .eq('facility_id', facilityId),
        supabase
          .from('facility_shift_settings')
          .select('*')
          .eq('facility_id', facilityId)
          .maybeSingle(),
        supabase
          .from('child_area_eligible_staff')
          .select('*')
          .eq('facility_id', facilityId),
      ]);

      /* 社員 → StaffRow projection (FacilityMemberRow から) */
      const staffRows: StaffRow[] = empRows.map((e: FacilityMemberRow) => ({
        id: e.id,
        tenant_id: e.tenant_id,
        facility_id: e.facility_id ?? '',
        name: `${e.last_name ?? ''} ${e.first_name ?? ''}`.trim(),
        email: e.email,
        role: (e.role as 'admin' | 'manager' | 'employee') ?? 'employee',
        employment_type: (e.employment_type as 'full_time' | 'part_time') ?? 'full_time',
        default_start_time: e.default_start_time,
        default_end_time: e.default_end_time,
        pickup_transport_areas: e.pickup_transport_areas ?? [],
        dropoff_transport_areas: e.dropoff_transport_areas ?? [],
        qualifications: e.qualifications ?? [],
        shift_qualifications: e.shift_qualifications ?? e.qualifications ?? [],
        is_qualified: e.is_qualified ?? false,
        is_driver: e.is_driver ?? false,
        is_attendant: e.is_attendant ?? false,
        shift_display_order: e.shift_display_order,
      }));
      setStaff(staffRows);

      setChildren(((childRes.data ?? []) as ChildRow[]).slice().sort((a, b) => {
        const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name, 'ja');
      }));

      /* 送迎表は「出席（isAttended）∪ キャンセル待ち（waitlist 集約バー表示用）」を保持する。
         キャンセル待ちは時刻有無に関わらず別セクションに表示するため特例扱い。 */
      setScheduleEntries(
        ((entryRes.data ?? []) as ScheduleEntryRow[]).filter(
          (e) => isAttended(e) || isWaitlist(e),
        ),
      );

      setShiftAssignments((shiftRes.data ?? []) as ShiftAssignmentRow[]);

      /* transport_assignments を当月分の schedule_entry_id で絞る */
      const entryIdSet = new Set(((entryRes.data ?? []) as ScheduleEntryRow[]).map((e) => e.id));
      setTransportAssignments(
        ((transportRes.data ?? []) as TransportAssignmentRow[]).filter((t) =>
          entryIdSet.has(t.schedule_entry_id)
        )
      );

      const settings = settingsRes.data ?? null;
      setPickupAreas((settings?.pickup_area_labels as AreaLabel[]) ?? []);
      setDropoffAreas((settings?.dropoff_area_labels as AreaLabel[]) ?? []);
      setTransportMinEndTime(
        (settings?.transport_min_end_time as string) ?? DEFAULT_TRANSPORT_MIN_END_TIME
      );
      setPickupCooldownMinutes(
        (settings?.transport_pickup_cooldown_minutes as number) ?? DEFAULT_PICKUP_COOLDOWN_MINUTES
      );
      /* 172: 列順は facility_shift_settings.transport_column_order を施設単位で共有。
         NULL なら useState 初期値 (DEFAULT_TRANSPORT_COLUMN_ORDER) を維持。
         将来カラム key が増減した場合でも安全に動くよう、保存値 ∩ DEFAULT で再構成 + 欠けは末尾追加 */
      const savedOrder = (settings?.transport_column_order as unknown) ?? null;
      if (Array.isArray(savedOrder) && savedOrder.length > 0) {
        const allowed = DEFAULT_TRANSPORT_COLUMN_ORDER as readonly string[];
        const valid = savedOrder.filter(
          (k): k is TransportColumnKey => typeof k === 'string' && allowed.includes(k)
        );
        const missing = DEFAULT_TRANSPORT_COLUMN_ORDER.filter((k) => !valid.includes(k));
        setColumnOrder([...valid, ...missing]);
      }

      setChildAreaEligibleStaff((eligRes.data ?? []) as ChildAreaEligibleStaffRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, facilityId, year, month, daysInMonth]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ブラウザ離脱時（タブ閉じ・リロード）に未保存警告 */
  useEffect(() => {
    if (pendingChanges.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pendingChanges]);

  const childNameMap = useMemo(() => new Map(children.map((c) => [c.id, c.name])), [children]);

  /* UI 用エントリ構築（Phase 64: waitlist は通常テーブルから除外） */
  const currentDayEntries: UiTransportEntry[] = useMemo(() => {
    const scheduleIds = scheduleEntries
      .filter((e) => e.date === selectedDate && e.attendance_status !== 'waitlist')
      .map((e) => e.id);
    const entryById = new Map(scheduleEntries.map((e) => [e.id, e]));
    const assignByEntry = new Map(transportAssignments.map((t) => [t.schedule_entry_id, t]));
    const childById = new Map(children.map((c) => [c.id, c]));
    const childOrderById = new Map(children.map((c, idx) => [c.id, idx]));
    const rows = scheduleIds.map((sid) => {
      const e = entryById.get(sid)!;
      const t = assignByEntry.get(sid);
      const spec = resolveEntryTransportSpec(e, {
        child: childById.get(e.child_id),
        pickupAreas,
        dropoffAreas,
      });

      const pending = pendingChanges.get(sid);
      const pickupStaffIds = pending?.pickupStaffIds ?? t?.pickup_employee_ids ?? [];
      const dropoffStaffIds = pending?.dropoffStaffIds ?? t?.dropoff_employee_ids ?? [];

      const pickupNeedsStaff = e.pickup_method !== 'self';
      const dropoffNeedsStaff = e.dropoff_method !== 'self';
      const pickupEmpty = pickupNeedsStaff && pickupStaffIds.length === 0;
      const dropoffEmpty = dropoffNeedsStaff && dropoffStaffIds.length === 0;
      const isUnassigned = pickupEmpty || dropoffEmpty;

      return {
        scheduleEntryId: sid,
        childId: e.child_id,
        childName: childNameMap.get(e.child_id) ?? '(不明)',
        pickupTime: spec.pickup.time ?? e.pickup_time,
        dropoffTime: spec.dropoff.time ?? e.dropoff_time,
        pickupLocation: spec.pickup.location,
        dropoffLocation: spec.dropoff.location,
        pickupAreaLabel: spec.pickup.areaLabel,
        dropoffAreaLabel: spec.dropoff.areaLabel,
        pickupAreaId: spec.pickup.areaId,
        dropoffAreaId: spec.dropoff.areaId,
        pickupStaffIds,
        dropoffStaffIds,
        isUnassigned,
        isConfirmed: t?.is_confirmed ?? false,
        pickupMethod: e.pickup_method,
        dropoffMethod: e.dropoff_method,
      };
    });
    rows.sort((a, b) => {
      const oa = childOrderById.get(entryById.get(a.scheduleEntryId)!.child_id) ?? Number.MAX_SAFE_INTEGER;
      const ob = childOrderById.get(entryById.get(b.scheduleEntryId)!.child_id) ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      const pa = a.pickupTime ?? '99:99';
      const pb = b.pickupTime ?? '99:99';
      if (pa !== pb) return pa < pb ? -1 : 1;
      const da = a.dropoffTime ?? '99:99';
      const db = b.dropoffTime ?? '99:99';
      if (da !== db) return da < db ? -1 : 1;
      return a.childName.localeCompare(b.childName, 'ja');
    });
    return rows;
  }, [
    selectedDate,
    scheduleEntries,
    transportAssignments,
    childNameMap,
    children,
    pickupAreas,
    dropoffAreas,
    pendingChanges,
  ]);

  /* Phase 64: 当日キャンセル待ち（順番昇順、null は末尾、同番号は児童 display_order 順） */
  type WaitlistDayEntry = {
    scheduleEntryId: string;
    childId: string;
    childName: string;
    pickupTime: string | null;
    dropoffTime: string | null;
    waitlistOrder: number | null;
  };
  const currentDayWaitlist: WaitlistDayEntry[] = useMemo(() => {
    const childOrderById = new Map(children.map((c, idx) => [c.id, idx]));
    const rows = scheduleEntries
      .filter((e) => e.date === selectedDate && e.attendance_status === 'waitlist')
      .map<WaitlistDayEntry>((e) => ({
        scheduleEntryId: e.id,
        childId: e.child_id,
        childName: childNameMap.get(e.child_id) ?? '(不明)',
        pickupTime: e.pickup_time,
        dropoffTime: e.dropoff_time,
        waitlistOrder: e.waitlist_order ?? null,
      }));
    rows.sort((a, b) => {
      const oa = a.waitlistOrder ?? 999;
      const ob = b.waitlistOrder ?? 999;
      if (oa !== ob) return oa - ob;
      const ca = childOrderById.get(a.childId) ?? Number.MAX_SAFE_INTEGER;
      const cb = childOrderById.get(b.childId) ?? Number.MAX_SAFE_INTEGER;
      return ca - cb;
    });
    return rows;
  }, [selectedDate, scheduleEntries, childNameMap, children]);

  /* Phase 64: 「利用に変える」確認モーダル */
  const [convertTarget, setConvertTarget] = useState<WaitlistDayEntry | null>(null);
  const [converting, setConverting] = useState(false);

  const handleConvertWaitlistToPresent = useCallback(async (target: WaitlistDayEntry) => {
    setConverting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('update_schedule_entry_attendance', {
        p_entry_id: target.scheduleEntryId,
        p_status: 'present',
        p_waitlist_order: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setConvertTarget(null);
      await fetchAll();
    } catch (e) {
      setToast({
        kind: 'error',
        message: e instanceof Error ? e.message : '切り替えに失敗しました',
      });
    } finally {
      setConverting(false);
    }
  }, [supabase, fetchAll]);

  const unassignedByDate = useMemo(() => {
    const map = new Map<string, number>();
    const assignMap = new Map(transportAssignments.map((t) => [t.schedule_entry_id, t]));
    for (const e of scheduleEntries) {
      const assign = assignMap.get(e.id);
      if (!assign) continue;
      const pending = pendingChanges.get(e.id);
      const pickupIds = pending?.pickupStaffIds ?? assign.pickup_employee_ids ?? [];
      const dropoffIds = pending?.dropoffStaffIds ?? assign.dropoff_employee_ids ?? [];
      const pickupNeedsStaff = e.pickup_method !== 'self';
      const dropoffNeedsStaff = e.dropoff_method !== 'self';
      const isUnassigned =
        (pickupNeedsStaff && pickupIds.length === 0) ||
        (dropoffNeedsStaff && dropoffIds.length === 0);
      if (isUnassigned) map.set(e.date, (map.get(e.date) ?? 0) + 1);
    }
    return map;
  }, [scheduleEntries, transportAssignments, pendingChanges]);

  const unassignedTotal = useMemo(() => {
    let total = 0;
    for (const v of unassignedByDate.values()) total += v;
    return total;
  }, [unassignedByDate]);

  const confirmed = currentDayEntries.length > 0 && currentDayEntries.every((e) => e.isConfirmed);
  const generated = transportAssignments.length > 0;

  const staffAreaMarksForDay = useMemo(() => {
    const pickupResult = new Map<string, string[]>();
    const dropoffResult = new Map<string, string[]>();
    /* Phase 64: waitlist は送迎担当を持たないため除外 */
    const dayEntries = scheduleEntries.filter(
      (e) => e.date === selectedDate && e.attendance_status !== 'waitlist',
    );
    const childById = new Map(children.map((c) => [c.id, c]));
    const TRIP_GAP_MIN = 30;

    const toMin = (t: string | null): number | null => {
      if (!t) return null;
      const m = /^(\d{1,2}):(\d{2})/.exec(t);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };

    const pickupRaw = new Map<string, Array<{ time: number; mark: string }>>();
    const dropoffRaw = new Map<string, Array<{ time: number; mark: string }>>();
    const pushRaw = (
      target: Map<string, Array<{ time: number; mark: string }>>,
      staffId: string,
      mark: string | null,
      time: number | null
    ) => {
      if (!staffId || !mark || time === null) return;
      const arr = target.get(staffId) ?? [];
      arr.push({ time, mark });
      target.set(staffId, arr);
    };

    const assignByEntryId = new Map(
      transportAssignments.map((t) => [t.schedule_entry_id, t])
    );

    for (const entry of dayEntries) {
      const spec = resolveEntryTransportSpec(entry, {
        child: childById.get(entry.child_id),
        pickupAreas,
        dropoffAreas,
      });
      const pickupEmoji = spec.pickup.areaLabel ? spec.pickup.areaLabel.trim().split(' ')[0] : null;
      const dropoffEmoji = spec.dropoff.areaLabel ? spec.dropoff.areaLabel.trim().split(' ')[0] : null;
      const pickupMin = toMin(entry.pickup_time);
      const dropoffMin = toMin(entry.dropoff_time);

      const pending = pendingChanges.get(entry.id);
      const existing = assignByEntryId.get(entry.id);
      const pickupIds = pending?.pickupStaffIds ?? existing?.pickup_employee_ids ?? [];
      const dropoffIds = pending?.dropoffStaffIds ?? existing?.dropoff_employee_ids ?? [];

      if (entry.pickup_method !== 'self') {
        pickupIds.forEach((sid) => pushRaw(pickupRaw, sid, pickupEmoji, pickupMin));
      }
      if (entry.dropoff_method !== 'self') {
        dropoffIds.forEach((sid) => pushRaw(dropoffRaw, sid, dropoffEmoji, dropoffMin));
      }
    }

    const compress = (
      raw: Map<string, Array<{ time: number; mark: string }>>,
      out: Map<string, string[]>
    ) => {
      for (const [staffId, items] of raw.entries()) {
        items.sort((a, b) => a.time - b.time);
        const acc: string[] = [];
        const lastTimeByMark = new Map<string, number>();
        for (const it of items) {
          const lt = lastTimeByMark.get(it.mark);
          if (lt === undefined || it.time - lt >= TRIP_GAP_MIN) {
            acc.push(it.mark);
          }
          lastTimeByMark.set(it.mark, it.time);
        }
        out.set(staffId, acc);
      }
    };
    compress(pickupRaw, pickupResult);
    compress(dropoffRaw, dropoffResult);

    return { pickup: pickupResult, dropoff: dropoffResult };
  }, [scheduleEntries, selectedDate, children, pickupAreas, dropoffAreas, pendingChanges, transportAssignments]);

  const availableStaffForDay = useMemo(() => {
    const shiftByStaffId = new Map<string, ShiftAssignmentRow[]>();
    for (const sa of shiftAssignments) {
      if (sa.date === selectedDate && sa.assignment_type === 'normal' && !!sa.end_time) {
        const arr = shiftByStaffId.get(sa.employee_id) ?? [];
        arr.push(sa);
        shiftByStaffId.set(sa.employee_id, arr);
      }
    }

    return staff.map((s) => {
      const daySegments = shiftByStaffId.get(s.id) ?? [];
      const latestEndTime =
        daySegments.length === 0
          ? null
          : daySegments.reduce<string | null>((acc, sa) => {
              if (!acc) return sa.end_time;
              return (sa.end_time as string) > acc ? (sa.end_time as string) : acc;
            }, null);
      const segments = daySegments
        .filter((sa) => sa.start_time && sa.end_time)
        .map((sa) => ({ startTime: sa.start_time as string, endTime: sa.end_time as string }));
      return {
        id: s.id,
        name: s.name,
        display_name: null,
        endTime: latestEndTime,
        segments,
        pickupAreaMarks: staffAreaMarksForDay.pickup.get(s.id) ?? [],
        dropoffAreaMarks: staffAreaMarksForDay.dropoff.get(s.id) ?? [],
        isDriver: s.is_driver,
        isAttendant: s.is_attendant,
        pickupAreaIds:
          s.pickup_transport_areas && s.pickup_transport_areas.length > 0
            ? s.pickup_transport_areas
            : [],
        dropoffAreaIds:
          s.dropoff_transport_areas && s.dropoff_transport_areas.length > 0
            ? s.dropoff_transport_areas
            : [],
      };
    });
  }, [staff, shiftAssignments, selectedDate, staffAreaMarksForDay]);

  /* ===== handlers ===== */

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!facilityId) return;
    setIsGenerating(true);

    /* lock 済みの日はスキップ */
    const lockedEntryIds = new Set(
      transportAssignments.filter((t) => t.is_locked).map((t) => t.schedule_entry_id)
    );
    const lockedDates = new Set<string>();
    for (const e of scheduleEntries) {
      if (lockedEntryIds.has(e.id)) lockedDates.add(e.date);
    }

    const targetDates = workDays.filter(
      (date) => scheduleEntries.some((e) => e.date === date) && !lockedDates.has(date)
    );
    setGenerateProgress({ current: 0, total: targetDates.length });

    try {
      let totalAssigned = 0;
      let totalUnassigned = 0;
      const errors: string[] = [];

      for (let i = 0; i < targetDates.length; i++) {
        const date = targetDates[i];
        setGenerateProgress({ current: i + 1, total: targetDates.length });
        /* Phase 64: waitlist は送迎担当の自動割り当て対象外 */
        const entriesForDate = scheduleEntries.filter(
          (e) => e.date === date && e.attendance_status !== 'waitlist',
        );

        const genRes = await fetch('/api/shifts/transport/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facility_id: facilityId,
            date,
            scheduleEntries: entriesForDate,
            staff,
            shiftAssignments: shiftAssignments.filter((a) => a.date === date),
            minEndTime: transportMinEndTime,
            children,
            pickupAreas,
            dropoffAreas,
            pickupCooldownMinutes,
          }),
        });
        if (!genRes.ok) {
          errors.push(`${date}: 生成 API エラー`);
          continue;
        }
        const { upserted, unassignedCount } = await genRes.json();
        totalAssigned += upserted ?? 0;
        totalUnassigned += unassignedCount ?? 0;
      }
      setPendingChanges(new Map());
      await fetchAll();

      const lockedSuffix =
        lockedDates.size > 0 ? ` ／ 🔒 保存済 ${lockedDates.size} 日はスキップ` : '';
      if (errors.length > 0) {
        setToast({
          kind: 'warning',
          message:
            `再生成完了（一部エラー）: 対象 ${totalAssigned} 件 / 未割当 ${totalUnassigned} 件` +
            ` / エラー ${errors.length} 件${lockedSuffix}`,
        });
      } else {
        setToast({
          kind: 'success',
          message:
            `再生成完了: ${totalAssigned} 件の担当を再割り当てしました` +
            (totalUnassigned > 0 ? ` (未割当 ${totalUnassigned} 件)` : '') +
            lockedSuffix,
        });
      }
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : '生成失敗' });
    } finally {
      setIsGenerating(false);
      setGenerateProgress(null);
    }
  };

  const handleStaffChange = (
    scheduleEntryId: string,
    field: 'pickup' | 'dropoff',
    staffIds: string[]
  ) => {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      const current = next.get(scheduleEntryId);
      const existing = transportAssignments.find((t) => t.schedule_entry_id === scheduleEntryId);
      const base: PendingAssignment = current ?? {
        pickupStaffIds: existing?.pickup_employee_ids ?? [],
        dropoffStaffIds: existing?.dropoff_employee_ids ?? [],
      };
      next.set(scheduleEntryId, {
        pickupStaffIds: field === 'pickup' ? staffIds : base.pickupStaffIds,
        dropoffStaffIds: field === 'dropoff' ? staffIds : base.dropoffStaffIds,
      });
      return next;
    });
  };

  const handleSaveDay = async () => {
    if (pendingChanges.size === 0) return;
    if (!tenantId || !facilityId) return;
    setSaving(true);
    try {
      const dayEntryIds = new Set(
        scheduleEntries.filter((e) => e.date === selectedDate).map((e) => e.id)
      );
      const entryById = new Map(scheduleEntries.map((e) => [e.id, e]));
      const payload: Array<{
        tenant_id: string;
        facility_id: string;
        schedule_entry_id: string;
        pickup_employee_ids: string[];
        dropoff_employee_ids: string[];
        is_unassigned: boolean;
        is_confirmed: boolean;
        is_locked: boolean;
      }> = [];

      for (const [sid, change] of pendingChanges.entries()) {
        if (!dayEntryIds.has(sid)) continue;
        const entry = entryById.get(sid);
        const existing = transportAssignments.find((t) => t.schedule_entry_id === sid);
        const pickupNeedsStaff = entry?.pickup_method !== 'self';
        const dropoffNeedsStaff = entry?.dropoff_method !== 'self';
        const pickupEmpty = pickupNeedsStaff && change.pickupStaffIds.length === 0;
        const dropoffEmpty = dropoffNeedsStaff && change.dropoffStaffIds.length === 0;
        payload.push({
          tenant_id: tenantId,
          facility_id: facilityId,
          schedule_entry_id: sid,
          pickup_employee_ids: change.pickupStaffIds,
          dropoff_employee_ids: change.dropoffStaffIds,
          is_unassigned: pickupEmpty || dropoffEmpty,
          is_confirmed: existing?.is_confirmed ?? false,
          is_locked: true,
        });
      }

      if (payload.length === 0) {
        setSaving(false);
        return;
      }

      const { error: upsertErr } = await supabase
        .from('transport_assignments')
        .upsert(payload, { onConflict: 'tenant_id,facility_id,schedule_entry_id' });
      if (upsertErr) throw new Error('保存失敗: ' + upsertErr.message);

      setPendingChanges((prev) => {
        const next = new Map(prev);
        for (const sid of dayEntryIds) next.delete(sid);
        return next;
      });
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleColumnReorder = async (next: TransportColumnKey[]) => {
    if (myRole !== 'admin' && myRole !== 'manager') return;
    const prev = columnOrder;
    setColumnOrder(next);
    /* 172: 施設単位で全員に共通の列順を共有 */
    const { error: updErr } = await supabase
      .from('facility_shift_settings')
      .update({ transport_column_order: next })
      .eq('facility_id', facilityId);
    if (updErr) {
      setColumnOrder(prev);
      setError('列順の保存に失敗しました');
    }
  };

  const pendingCountForDay = useMemo(() => {
    const ids = new Set(scheduleEntries.filter((e) => e.date === selectedDate).map((e) => e.id));
    let c = 0;
    for (const sid of pendingChanges.keys()) if (ids.has(sid)) c++;
    return c;
  }, [pendingChanges, scheduleEntries, selectedDate]);

  const handleAddCustomArea = async (
    childId: string,
    direction: 'pickup' | 'dropoff',
    area: { emoji: string; name: string; time: string; address: string }
  ) => {
    if (myRole !== 'admin' && myRole !== 'manager') {
      throw new Error('この操作には編集権限が必要です');
    }
    const child = children.find((c) => c.id === childId);
    if (!child) throw new Error('児童が見つかりません');

    const customKey = direction === 'pickup' ? 'custom_pickup_areas' : 'custom_dropoff_areas';
    const labelKey = direction === 'pickup' ? 'pickup_area_labels' : 'dropoff_area_labels';
    const newId = crypto.randomUUID();

    const childRec = child as unknown as Record<string, unknown>;
    const nextCustom = [
      ...((childRec[customKey] as AreaLabel[]) ?? []),
      {
        id: newId,
        emoji: area.emoji,
        name: area.name,
        ...(area.time ? { time: area.time } : {}),
        ...(area.address ? { address: area.address } : {}),
      },
    ];
    const currentLabels = (childRec[labelKey] as string[]) ?? [];
    const nextLabels = [...currentLabels, newId];

    const { error: updErr } = await supabase
      .from('children')
      .update({ [customKey]: nextCustom, [labelKey]: nextLabels })
      .eq('id', childId);
    if (updErr) throw new Error('登録に失敗しました: ' + updErr.message);
    await fetchAll();
  };

  const handleSaveAddShift = async () => {
    if (!addShiftModal) return;
    if (myRole !== 'admin' && myRole !== 'manager') {
      setAddShiftModal((prev) => (prev ? { ...prev, errorMsg: '権限がありません' } : prev));
      return;
    }
    if (!addShiftModal.staffId) {
      setAddShiftModal((prev) => (prev ? { ...prev, errorMsg: '職員を選択してください' } : prev));
      return;
    }
    if (!addShiftModal.startTime || !addShiftModal.endTime) {
      setAddShiftModal((prev) =>
        prev ? { ...prev, errorMsg: '開始・終了時刻を入力してください' } : prev
      );
      return;
    }
    if (addShiftModal.startTime >= addShiftModal.endTime) {
      setAddShiftModal((prev) =>
        prev ? { ...prev, errorMsg: '終了時刻は開始時刻より後にしてください' } : prev
      );
      return;
    }
    if (!tenantId || !facilityId) return;

    setAddShiftModal((prev) => (prev ? { ...prev, saving: true, errorMsg: '' } : prev));

    /* Phase 66+: 共通ヘルパー replaceShiftDay 経由で 1 日まるごと送信。
       segment_order の採番はヘルパー側で行うので、クライアントでの計算ロジックを廃止。
       'off'（休み）行はシフト生成のダミーなので維持しない（送信前に除外）→ 結果的にゴミ off 行が掃除される。
       paid_leave / public_holiday / requested_off は normal と同列で残す（分割の前後コマとして扱う）。 */
    const staffId = addShiftModal.staffId;
    const existingSegments = shiftAssignments
      .filter(
        (sa) =>
          sa.employee_id === staffId &&
          sa.date === selectedDate &&
          sa.assignment_type !== 'off'
      )
      .sort((a, b) => (a.segment_order ?? 0) - (b.segment_order ?? 0));

    const newSegment: ShiftSegmentInput = {
      start_time: addShiftModal.startTime,
      end_time: addShiftModal.endTime,
      assignment_type: 'normal',
      note: null,
    };
    const segments: ShiftSegmentInput[] = [
      ...existingSegments.map<ShiftSegmentInput>((sa) => ({
        start_time: sa.start_time,
        end_time: sa.end_time,
        assignment_type: sa.assignment_type,
        note: sa.note ?? null,
      })),
      newSegment,
    ];

    /* publish_status / is_confirmed は既存セグメントの状態を引き継ぐ（無ければ draft / 未確定）。
       送迎表からの追加で保留中のシフトを意図せず公開・確定状態で書き換えないように。 */
    const firstExisting = existingSegments[0];
    const result = await replaceShiftDay({
      supabase,
      tenantId,
      facilityId,
      employeeId: staffId,
      date: selectedDate,
      segments,
      isConfirmed: firstExisting?.is_confirmed ?? false,
      publishStatus: (firstExisting?.publish_status as 'draft' | 'ready' | 'published') ?? 'draft',
    });
    if (!result.ok) {
      setAddShiftModal((prev) =>
        prev ? { ...prev, saving: false, errorMsg: result.error } : prev,
      );
      return;
    }
    setAddShiftModal(null);
    await fetchAll();
  };

  const handleSelectDate = (date: string) => {
    if (pendingCountForDay > 0) {
      const ok = confirm(`この日に未保存の変更が ${pendingCountForDay} 件あります。破棄して切り替えますか？`);
      if (!ok) return;
      setPendingChanges((prev) => {
        const next = new Map(prev);
        const ids = new Set(
          scheduleEntries.filter((e) => e.date === selectedDate).map((e) => e.id)
        );
        for (const sid of ids) next.delete(sid);
        return next;
      });
    }
    setSelectedDate(date);
  };

  const handleConfirm = async () => {
    if (!confirm(`${year}年${month}月の送迎表を確定しますか？`)) return;
    if (!facilityId) return;
    /* 当月分の transport_assignments 全行を is_confirmed=true */
    const entryIds = scheduleEntries.map((e) => e.id);
    if (entryIds.length === 0) return;
    const { error: updErr } = await supabase
      .from('transport_assignments')
      .update({ is_confirmed: true })
      .eq('facility_id', facilityId)
      .in('schedule_entry_id', entryIds);
    if (updErr) {
      alert('確定失敗: ' + updErr.message);
      return;
    }
    setPendingChanges(new Map());
    await fetchAll();
  };

  const tenantAreaIds = useMemo(
    () => [...pickupAreas.map((a) => a.id), ...dropoffAreas.map((a) => a.id)],
    [pickupAreas, dropoffAreas]
  );

  if (!facilityId) {
    return (
      <div className="rounded-md bg-white border border-brand-gray/10 p-8 text-center">
        <p className="text-sm text-brand-gray">
          ヘッダーから事業所を選択してください。
        </p>
      </div>
    );
  }

  return (
    /* 親レイアウト (admin/manager) の p-6 lg:p-8 を打ち消して縦横をフルに使う。
       シフト表 / 利用表 と padding を統一。 */
    <div className="flex flex-col h-full overflow-hidden -m-6 lg:-m-8">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes transport-toast-in {
              from { opacity: 0; transform: translate(-50%, -8px); }
              to   { opacity: 1; transform: translate(-50%, 0); }
            }
            @keyframes transport-spin {
              to { transform: rotate(360deg); }
            }
          `,
        }}
      />

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      {/* 日付ステッパ — 利用表/シフト表の MonthStepper と同じ視覚スタイルで日次ナビ */}
      <div className="px-6 pt-1 pb-1.5 print-hide">
        <DateStepperFull value={selectedDate} onChange={handleSelectDate} dayStates={dayStates} />
      </div>

      <div className="px-6 py-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            {/* 当日利用人数 + Phase 64: キャンセル待ち件数 */}
            {(() => {
              const dayEntries = scheduleEntries.filter(
                (e) => e.date === selectedDate && isAttended(e),
              );
              const waitlistCount = scheduleEntries.filter(
                (e) => e.date === selectedDate && isWaitlist(e),
              ).length;
              return (
                <>
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded"
                    style={{
                      background: 'var(--bg)',
                      color: 'var(--ink-2)',
                      border: '1px solid var(--rule)',
                    }}
                    title="この日の利用児童数（欠席・キャンセル待ち除く）"
                  >
                    🧒 利用 {dayEntries.length}人
                  </span>
                  {waitlistCount > 0 && (
                    <span
                      className="text-xs font-semibold px-2 py-1 rounded"
                      style={{
                        background: 'var(--bg)',
                        color: 'var(--ink-2)',
                        border: '1px dashed var(--rule-strong)',
                      }}
                      title="この日のキャンセル待ち件数"
                    >
                      ⏳ 待 {waitlistCount}人
                    </span>
                  )}
                </>
              );
            })()}
            {(() => {
              const onDuty = availableStaffForDay.filter((s) => !!s.endTime);
              const driverCount = onDuty.filter((s) => s.isDriver).length;
              return (
                <>
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded"
                    style={{
                      background: 'var(--bg)',
                      color: 'var(--ink-2)',
                      border: '1px solid var(--rule)',
                    }}
                    title="この日の出勤職員数"
                  >
                    👤 出勤 {onDuty.length}人
                  </span>
                  {onDuty.length > 0 && driverCount === 0 && (
                    <span
                      className="text-xs font-bold px-2 py-1 rounded"
                      style={{
                        background: 'var(--red-pale)',
                        color: 'var(--red)',
                        border: '1.5px solid var(--red)',
                      }}
                      title="この日は運転手の出勤がありません。自動割り当てが成立しません。"
                    >
                      ⚠ 運転手不在
                    </span>
                  )}
                </>
              );
            })()}
            {pendingCountForDay === 0 &&
              transportAssignments.some(
                (t) =>
                  t.is_locked &&
                  scheduleEntries.some(
                    (e) => e.id === t.schedule_entry_id && e.date === selectedDate
                  )
              ) && (
                <span
                  className="text-xs font-semibold px-2 py-1 rounded"
                  style={{
                    background: 'var(--accent-pale)',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                  }}
                  title="この日は手動で保存済みです。再生成でスキップされます。"
                >
                  🔒 保存済
                </span>
              )}
            {pendingCountForDay > 0 && (
              <span
                className="text-xs font-semibold px-2 py-1 rounded"
                style={{
                  background: 'rgba(212,160,23,0.1)',
                  color: 'var(--gold, #b8860b)',
                  border: '1px solid var(--gold, #d4a017)',
                }}
                title="未保存の編集があります"
              >
                ✏️ 編集中（{pendingCountForDay}件未保存）
              </span>
            )}
          </div>
          <div className="flex gap-2 print-hide flex-wrap">
            <Button
              variant="secondary"
              onClick={() => {
                /* 週次送迎出力ページへ遷移。サイドバーから外して送迎表の出力アクションに統合（2026-04-26）。
                   role に応じて admin/mgr の URL を切替。 */
                const href = role === 'admin'
                  ? '/admin/shifts/output/weekly-transport'
                  : '/mgr/shifts/output/weekly-transport';
                window.location.href = href;
              }}
              title="週次送迎表（A3 縦・1 週 1 ページ）を出力"
            >
              📅 週次送迎を出力
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                setAddShiftModal({
                  step: 'pick',
                  staffId: '',
                  startTime: '09:00',
                  endTime: '17:00',
                  saving: false,
                  errorMsg: '',
                })
              }
              disabled={!selectedDate}
              title="この日に出勤する職員を追加"
            >
              ＋ シフト追加
            </Button>
            {generated && !confirmed && unassignedTotal === 0 && (
              <Button variant="primary" onClick={handleConfirm}>
                送迎表確定
              </Button>
            )}
            <Button
              variant={generated ? 'secondary' : 'primary'}
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                confirmed ||
                scheduleEntries.length === 0 ||
                staff.length === 0
              }
            >
              {isGenerating ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  <span>
                    生成中
                    {generateProgress && generateProgress.total > 0
                      ? ` (${generateProgress.current}/${generateProgress.total})`
                      : '…'}
                  </span>
                </span>
              ) : generated ? (
                '再生成'
              ) : (
                '割り当て生成'
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div
            className="mb-3 px-4 py-2 rounded"
            style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
            読み込み中...
          </div>
        ) : (
          <>
            {!generated && scheduleEntries.length > 0 && (
              <div
                className="mb-4 px-4 py-3 rounded"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink-3)',
                  fontSize: '0.85rem',
                }}
              >
                送迎担当が未生成です。上部「割り当て生成」で自動割り当て、または下のドロップダウンで手動割当できます。
              </div>
            )}

            <TransportDayView
              children={currentDayEntries.map((e) => ({
                id: e.scheduleEntryId,
                scheduleEntryId: e.scheduleEntryId,
                childId: e.childId,
                name: e.childName,
                pickupTime: e.pickupTime,
                dropoffTime: e.dropoffTime,
                pickupLocation: e.pickupLocation,
                dropoffLocation: e.dropoffLocation,
                pickupAreaLabel: e.pickupAreaLabel,
                dropoffAreaLabel: e.dropoffAreaLabel,
                pickupAreaId: e.pickupAreaId,
                dropoffAreaId: e.dropoffAreaId,
                pickupStaffIds: e.pickupStaffIds,
                dropoffStaffIds: e.dropoffStaffIds,
                isUnassigned: e.isUnassigned,
                pickupMethod: e.pickupMethod,
                dropoffMethod: e.dropoffMethod,
              }))}
              availableStaff={availableStaffForDay}
              transportMinEndTime={transportMinEndTime}
              tenantAreaIds={tenantAreaIds}
              childAreaEligibleStaff={childAreaEligibleStaff}
              onStaffChange={handleStaffChange}
              dayLocked={dayStates.get(selectedDate)?.locked === true}
              disabled={confirmed}
              columnOrder={columnOrder}
              onColumnReorder={handleColumnReorder}
              onAddCustomArea={handleAddCustomArea}
            />

            {/* Phase 64: キャンセル待ち集約バー（兄弟同番号 OK / 「利用に変える」で確認モーダル） */}
            {currentDayWaitlist.length > 0 && (
              <div
                className="mt-3 px-4 py-3 rounded flex items-center flex-wrap gap-x-4 gap-y-2"
                style={{
                  background: 'rgba(0,0,0,0.04)',
                  border: '1px solid var(--rule)',
                  fontSize: '0.85rem',
                }}
              >
                <span className="font-bold whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>
                  キャンセル待ち
                </span>
                {currentDayWaitlist.map((w) => {
                  const orderMark = w.waitlistOrder ? '①②③④⑤⑥⑦⑧⑨⑩'.charAt(w.waitlistOrder - 1) : '－';
                  const timeRange = w.pickupTime || w.dropoffTime
                    ? `${w.pickupTime ? w.pickupTime.slice(0, 5) : '?'}〜${w.dropoffTime ? w.dropoffTime.slice(0, 5) : '?'}`
                    : null;
                  return (
                    <span key={w.scheduleEntryId} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span style={{ color: 'var(--ink-2)', fontWeight: 700 }}>{orderMark}</span>
                      <span>{w.childName}</span>
                      {timeRange && (
                        <span style={{ color: 'var(--ink-3)', fontSize: '0.78rem' }}>
                          ({timeRange})
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setConvertTarget(w)}
                        className="ml-1 text-xs font-semibold px-2 py-0.5 rounded print-hide"
                        style={{
                          background: 'var(--white)',
                          color: 'var(--accent)',
                          border: '1px solid var(--accent)',
                        }}
                      >
                        利用に変える
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-4 print-hide">
              {pendingCountForDay > 0 && (
                <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                  未保存 {pendingCountForDay} 件
                </span>
              )}
              {(() => {
                const currentDayLocked = transportAssignments.some(
                  (t) =>
                    t.is_locked &&
                    scheduleEntries.some(
                      (e) => e.id === t.schedule_entry_id && e.date === selectedDate
                    )
                );
                const showSaved = pendingCountForDay === 0 && currentDayLocked && !saving;
                return (
                  <Button
                    variant="primary"
                    onClick={handleSaveDay}
                    disabled={saving || pendingCountForDay === 0 || confirmed}
                  >
                    {saving
                      ? '保存中...'
                      : pendingCountForDay > 0
                      ? `この日の送迎を保存（${pendingCountForDay}件）`
                      : showSaved
                      ? '✅ 保存済み'
                      : 'この日の送迎を保存'}
                  </Button>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {addShiftModal && (
        <Modal
          isOpen={true}
          onClose={() => (addShiftModal.saving ? null : setAddShiftModal(null))}
          title={
            addShiftModal.step === 'pick'
              ? `シフト追加（${selectedDate}）— 職員を選択`
              : `シフト追加（${selectedDate}）— 時間を入力`
          }
          size="md"
        >
          {addShiftModal.step === 'pick' ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                この日に出勤する職員を選択してください。既に当日シフトがある職員は分割シフトとして追加されます。
              </p>
              <div
                className="flex flex-col overflow-y-auto"
                style={{
                  maxHeight: '52vh',
                  border: '1px solid var(--rule)',
                  borderRadius: '8px',
                  background: 'var(--white)',
                }}
              >
                {buildPickerItems(staff, shiftAssignments, selectedDate).map((item, idx) => {
                  const badgeColor =
                    item.leaveLabel === '有給'
                      ? 'var(--green, #2f8f57)'
                      : item.leaveLabel === '希望休'
                      ? 'var(--gold, #8a6120)'
                      : item.leaveLabel === '公休'
                      ? 'var(--accent)'
                      : null;
                  const badgeBg =
                    item.leaveLabel === '有給'
                      ? 'var(--green-pale, rgba(47,143,87,0.10))'
                      : item.leaveLabel === '希望休'
                      ? 'var(--gold-pale, rgba(138,97,32,0.10))'
                      : item.leaveLabel === '公休'
                      ? 'var(--accent-pale)'
                      : null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        const picked = staff.find((s) => s.id === item.id);
                        setAddShiftModal((prev) => {
                          if (!prev) return prev;
                          const start = picked?.default_start_time?.slice(0, 5) ?? prev.startTime;
                          const end = picked?.default_end_time?.slice(0, 5) ?? prev.endTime;
                          return {
                            ...prev,
                            staffId: item.id,
                            startTime: start,
                            endTime: end,
                            step: 'time',
                            errorMsg: '',
                          };
                        });
                      }}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors text-left"
                      style={{
                        background: idx % 2 === 1 ? 'rgba(0,0,0,0.025)' : 'transparent',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--rule)',
                      }}
                    >
                      <span className="text-base font-medium" style={{ color: 'var(--ink)' }}>
                        {item.name}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {item.leaveLabel && badgeColor && badgeBg && (
                          <span
                            className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: badgeBg, color: badgeColor, border: `1px solid ${badgeColor}` }}
                          >
                            ⚠ {item.leaveLabel}
                          </span>
                        )}
                        {item.hasShift && !item.leaveLabel && (
                          <span
                            className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                            style={{
                              background: 'var(--bg)',
                              color: 'var(--ink-2)',
                              border: '1px solid var(--rule-strong)',
                            }}
                          >
                            分割追加
                          </span>
                        )}
                        <span style={{ color: 'var(--ink-3)', fontSize: '0.8rem' }}>›</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end mt-1">
                <Button variant="secondary" onClick={() => setAddShiftModal(null)}>
                  キャンセル
                </Button>
              </div>
            </div>
          ) : (
            (() => {
              const picked = staff.find((s) => s.id === addShiftModal.staffId);
              const leave = shiftAssignments.find(
                (sa) =>
                  sa.employee_id === addShiftModal.staffId &&
                  sa.date === selectedDate &&
                  (sa.assignment_type === 'public_holiday' ||
                    sa.assignment_type === 'requested_off' ||
                    sa.assignment_type === 'paid_leave')
              );
              const hasShift = shiftAssignments.some(
                (sa) =>
                  sa.employee_id === addShiftModal.staffId &&
                  sa.date === selectedDate &&
                  sa.assignment_type === 'normal'
              );
              const leaveAType = leave?.assignment_type;
              const leaveLabel =
                leaveAType === 'paid_leave'
                  ? '有給'
                  : leaveAType === 'requested_off'
                  ? '希望休'
                  : leaveAType === 'public_holiday'
                  ? '公休'
                  : null;
              const leaveColor =
                leaveAType === 'paid_leave'
                  ? 'var(--green, #2f8f57)'
                  : leaveAType === 'requested_off'
                  ? 'var(--gold, #8a6120)'
                  : 'var(--accent)';
              const leaveBg =
                leaveAType === 'paid_leave'
                  ? 'var(--green-pale, rgba(47,143,87,0.10))'
                  : leaveAType === 'requested_off'
                  ? 'var(--gold-pale, rgba(138,97,32,0.10))'
                  : 'var(--accent-pale)';
              return (
                <div className="flex flex-col gap-3">
                  <div
                    className="flex items-center justify-between gap-3 px-4 py-3 rounded"
                    style={{ background: 'var(--accent-pale)', border: '1px solid var(--accent)' }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base font-bold truncate" style={{ color: 'var(--ink)' }}>
                        {picked?.name ?? '(未選択)'}
                      </span>
                      {leaveLabel && (
                        <span
                          className="shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: leaveBg, color: leaveColor, border: `1px solid ${leaveColor}` }}
                        >
                          ⚠ {leaveLabel}
                        </span>
                      )}
                      {hasShift && !leaveLabel && (
                        <span
                          className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            background: 'var(--white)',
                            color: 'var(--ink-2)',
                            border: '1px solid var(--rule-strong)',
                          }}
                        >
                          分割追加
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAddShiftModal((prev) =>
                          prev ? { ...prev, step: 'pick', errorMsg: '' } : prev
                        )
                      }
                      className="text-xs font-semibold whitespace-nowrap shrink-0"
                      style={{ color: 'var(--accent)' }}
                      disabled={addShiftModal.saving}
                    >
                      ← 職員を変更
                    </button>
                  </div>

                  {leave && leaveLabel && (
                    <div
                      className="text-xs px-3 py-2 rounded"
                      style={{
                        background: leaveBg,
                        color: leaveColor,
                        border: `1px solid ${leaveColor}`,
                      }}
                    >
                      ⚠ この職員は当日「{leaveLabel}」扱いです。出勤として追加すると現在のシフトが上書きされます。
                    </div>
                  )}

                  <div className="flex gap-3">
                    <label className="flex-1 flex flex-col gap-1">
                      <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                        開始
                      </span>
                      <input
                        type="time"
                        value={addShiftModal.startTime}
                        onChange={(e) =>
                          setAddShiftModal((prev) => (prev ? { ...prev, startTime: e.target.value } : prev))
                        }
                        disabled={addShiftModal.saving}
                        style={{
                          padding: '8px 10px',
                          fontSize: '0.95rem',
                          border: '1px solid var(--rule)',
                          borderRadius: '6px',
                          background: 'var(--white)',
                        }}
                      />
                    </label>
                    <label className="flex-1 flex flex-col gap-1">
                      <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                        終了
                      </span>
                      <input
                        type="time"
                        value={addShiftModal.endTime}
                        onChange={(e) =>
                          setAddShiftModal((prev) => (prev ? { ...prev, endTime: e.target.value } : prev))
                        }
                        disabled={addShiftModal.saving}
                        style={{
                          padding: '8px 10px',
                          fontSize: '0.95rem',
                          border: '1px solid var(--rule)',
                          borderRadius: '6px',
                          background: 'var(--white)',
                        }}
                      />
                    </label>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                    職員の基本出勤・退勤時刻を初期値にしています。早朝・夜間など必要に応じて変更できます。
                  </p>

                  {addShiftModal.errorMsg && (
                    <div
                      className="px-3 py-2 rounded text-xs"
                      style={{ background: 'var(--red-pale)', color: 'var(--red)' }}
                    >
                      {addShiftModal.errorMsg}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 mt-2">
                    <Button
                      variant="secondary"
                      onClick={() => setAddShiftModal(null)}
                      disabled={addShiftModal.saving}
                    >
                      キャンセル
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleSaveAddShift}
                      disabled={addShiftModal.saving || !addShiftModal.staffId}
                    >
                      {addShiftModal.saving ? '保存中…' : '追加'}
                    </Button>
                  </div>
                </div>
              );
            })()
          )}
        </Modal>
      )}

      {/* Phase 64: キャンセル待ち → 利用 切替確認モーダル */}
      {convertTarget && (
        <Modal
          isOpen={true}
          onClose={() => (converting ? null : setConvertTarget(null))}
          title="キャンセル待ち → 利用 への切替"
          size="md"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm" style={{ lineHeight: 1.6 }}>
              <span className="font-bold">{convertTarget.childName}</span> さんを本日の{' '}
              <span className="font-bold" style={{ color: 'var(--green)' }}>利用 (出席)</span>{' '}
              に切り替えます。
            </p>
            <div
              className="px-3 py-2 rounded text-sm"
              style={{ background: 'var(--bg)', border: '1px solid var(--rule)' }}
            >
              利用時間:{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {convertTarget.pickupTime ? convertTarget.pickupTime.slice(0, 5) : '?'}
                {' 〜 '}
                {convertTarget.dropoffTime ? convertTarget.dropoffTime.slice(0, 5) : '?'}
              </span>
              <div className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
                切替後は送迎担当が未割当の状態になります。送迎表で担当を割り当ててください。
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-2">
              <Button
                variant="secondary"
                onClick={() => setConvertTarget(null)}
                disabled={converting}
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                onClick={() => handleConvertWaitlistToPresent(convertTarget)}
                disabled={converting}
              >
                {converting ? '切替中...' : '利用に変える'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ animation: 'transport-spin 0.7s linear infinite' }}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ToastBanner({
  toast,
  onClose,
}: {
  toast: { kind: 'success' | 'warning' | 'error'; message: string };
  onClose: () => void;
}) {
  const accent =
    toast.kind === 'success'
      ? { border: 'rgba(42,122,82,0.28)', icon: '✓', iconColor: 'rgb(28,90,60)' }
      : toast.kind === 'warning'
      ? { border: 'rgba(200,140,30,0.32)', icon: '⚠', iconColor: 'rgb(160,110,20)' }
      : { border: 'rgba(200,50,50,0.32)', icon: '✕', iconColor: 'rgb(170,40,40)' };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[100] flex items-start gap-3"
      style={{
        top: '18px',
        left: '50%',
        maxWidth: 'min(520px, calc(100vw - 24px))',
        padding: '12px 16px',
        background: '#fff',
        border: `1px solid ${accent.border}`,
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
        animation: 'transport-toast-in 200ms ease-out',
        fontSize: '0.875rem',
        lineHeight: 1.5,
      }}
    >
      <span aria-hidden="true" style={{ color: accent.iconColor, fontSize: '1rem', fontWeight: 700, marginTop: '1px' }}>
        {accent.icon}
      </span>
      <span style={{ color: 'var(--ink)', fontWeight: 500, flex: 1 }}>{toast.message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="通知を閉じる"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--ink-3)',
          cursor: 'pointer',
          fontSize: '0.9rem',
          padding: '2px 4px',
          marginLeft: '4px',
        }}
      >
        ×
      </button>
    </div>
  );
}

