'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import Button from '@/components/shift-compat/Button';
import DateStepperFull from '@/components/shift/DateStepperFull';
import { defaultOutputDate } from '@/lib/date/defaultOutputDate';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';
import { resolveEntryTransportSpec } from '@/lib/shift-logic/resolveTransportSpec';
import { staffDisplayName } from '@/lib/shift-utils';
import type { GradeType } from '@/lib/constants';
import type {
  StaffRow,
  ChildRow,
  ScheduleEntryRow,
  ShiftAssignmentRow,
  TransportAssignmentRow,
  AreaLabel,
} from '@/lib/types';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * 日次出力ページ（deaf-ic 版） — shift-puzzle Phase 31 のホワイトボード風レイアウトを忠実移植。
 *
 * 主な差分:
 *  - tenant 単独 → tenant + facility 二重スコープ（useShiftFacilityId）
 *  - 全 fetch を supabase client 直叩きに変更（RLS で facility 単位に絞られる）
 *  - staff_id → employee_id, pickup_staff_ids → pickup_employee_ids
 *  - useCurrentStaff() / isDateOutOfRange() への依存を削除（deaf-ic は employee 側 RLS）
 *  - publish_status はフィルタしない（draft/ready/published すべて表示。admin/manager の印刷物のため）
 *  - tenant_settings.pickup_areas → facility_shift_settings.pickup_area_labels
 *  - /api/transport/child-order → /api/shifts/transport/child-order（facility_id 必須）
 *
 * ヤバいロジックは温存:
 *  - 児童マーク 2 行分割（splitChildName）
 *  - 学年色分け（getGradeColors）
 *  - 迎(1/1/2/3..) / 送(2/3..) のセル配置（slotCell）
 *  - 学習記憶（child_display_order_memory）の signature 生成と適用
 *  - 同担当者で時刻一致のスロット統合
 *  - 保護者送迎 (method='self') の「👪 保護者」表示と未割当扱いから除外
 *  - ta が無い児童も赤枠で「⚠ 担当未割当」表示（Phase 43）
 *  - attendance_status='absent'/'leave' は除外
 *  - 分割シフト対応 (assignment_type='normal' のみ集約、segment_order ソート、" / " 連結)
 *  - A3 portrait 印刷 CSS（@page、min-width 1100px、サイドバー hide、color-adjust exact）
 */

/** 児童名をマーク円内で 2 行表示するために分割。
    空白区切りがあればそこで分ける。無ければ文字列中央で分ける。2 文字以下は 1 行のまま。 */
function splitChildName(name: string): string[] {
  const t = (name ?? '').trim();
  const parts = t.split(/\s+/);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join('')];
  if (t.length <= 2) return [t];
  const mid = Math.ceil(t.length / 2);
  return [t.slice(0, mid), t.slice(mid)];
}

/** 児童管理 (settings/children) の getGradeRowBg と揃えた色分け。
    bg/border/text を返す。preschool=青系 / nursery=赤系 / 他=緑系。
    Phase 37: 背景 0.14→0.28、ボーダー 0.75→1.0 で 2 段階濃く（視認性向上） */
function getGradeColors(grade: GradeType): { bg: string; border: string; text: string } {
  switch (grade) {
    case 'preschool':
      return { bg: 'rgba(26,62,184,0.28)', border: 'rgba(26,62,184,1)', text: 'rgb(16,40,120)' };
    case 'nursery_3':
    case 'nursery_4':
    case 'nursery_5':
      return { bg: 'rgba(155,51,51,0.28)', border: 'rgba(155,51,51,1)', text: 'rgb(120,35,35)' };
    default:
      return { bg: 'rgba(42,122,82,0.28)', border: 'rgba(42,122,82,1)', text: 'rgb(28,90,60)' };
  }
}

type TransportSlot = {
  time: string;
  direction: 'pickup' | 'dropoff';
  /** 同一担当者にまとめた結果、複数エリアを跨ぐ場合に備えて配列で保持 */
  areaLabels: string[];
  /** Phase 35: 学習記憶の signature 生成用。areaLabels と同じ並びの ID 群（無いものは除外） */
  areaIds: string[];
  children: Array<{
    /** Phase 35: DnD 並び順保存用 */
    id: string;
    name: string;
    areaEmoji: string | null;
    /** Phase 38: emoji と並べてバッジ上に表示する場所名 (例: '自宅', '知多ガラス') */
    areaName: string | null;
    grade: GradeType;
  }>;
  staffIds: string[];
  isUnassigned: boolean;
  isConfirmed: boolean;
  /** 保護者送迎（method='self'）。担当欄に「👪 保護者」を表示し、未割当扱いしない。 */
  isSelfTransport: boolean;
};

/** Phase 35: スロット条件のシグネチャ。日付・職員・児童に依存しないキー。
 *  例: "13:20|pickup|<uuid1>,<uuid2>"  (areaIds はソート済み) */
function buildSlotSignature(slot: { time: string; direction: 'pickup' | 'dropoff'; areaIds: string[] }): string {
  const ids = [...slot.areaIds].sort().join(',');
  return `${slot.time}|${slot.direction}|${ids}`;
}

type OnDutyStaff = {
  id: string;
  name: string;
  start: string;
  end: string;
};

type ChildOrderMemoryRow = {
  slot_signature: string;
  child_id: string;
  display_order: number;
};

function fmtTime(t: string | null): string {
  if (!t) return '';
  return t.length >= 5 ? t.slice(0, 5) : t;
}

interface Props {
  /** 'admin' or 'manager'。employee は来ない想定（ルーティング段階で弾かれる） */
  role: 'admin' | 'manager';
}

export default function DailyOutputFull({ role: _role }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId] = useShiftFacilityId();

  const [date, setDate] = useState<string>(() => defaultOutputDate());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [entries, setEntries] = useState<ScheduleEntryRow[]>([]);
  const [shifts, setShifts] = useState<ShiftAssignmentRow[]>([]);
  const [transportAssignments, setTransportAssignments] = useState<TransportAssignmentRow[]>([]);
  const [pickupAreas, setPickupAreas] = useState<AreaLabel[]>([]);
  const [dropoffAreas, setDropoffAreas] = useState<AreaLabel[]>([]);
  /* Phase 35: 日次出力カードの児童 DnD 並び順学習記憶。signature → (childId → order) */
  const [orderMemory, setOrderMemory] = useState<Map<string, Map<string, number>>>(new Map());

  const fetchAll = useCallback(async () => {
    if (!facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [empRes, childRes, entryRes, shiftRes, transportRes, settingsRes] = await Promise.all([
        supabase
          .from('employees')
          .select(
            'id, tenant_id, facility_id, last_name, first_name, email, role, employment_type, default_start_time, default_end_time, pickup_transport_areas, dropoff_transport_areas, qualifications, is_qualified, is_driver, is_attendant, shift_display_order, status'
          )
          .eq('facility_id', facilityId)
          .eq('status', 'active'),
        supabase.from('children').select('*').eq('facility_id', facilityId),
        supabase
          .from('schedule_entries')
          .select('*')
          .eq('facility_id', facilityId)
          .eq('date', date),
        supabase
          .from('shift_assignments')
          .select('*')
          .eq('facility_id', facilityId)
          .eq('date', date),
        supabase
          .from('transport_assignments')
          .select('*')
          .eq('facility_id', facilityId),
        supabase
          .from('facility_shift_settings')
          .select('pickup_area_labels, dropoff_area_labels')
          .eq('facility_id', facilityId)
          .maybeSingle(),
      ]);

      const staffRows: StaffRow[] = (empRes.data ?? []).map((e: Record<string, unknown>) => {
        const lastName = (e.last_name as string | null) ?? '';
        const firstName = (e.first_name as string | null) ?? '';
        return {
          id: e.id as string,
          tenant_id: e.tenant_id as string,
          facility_id: e.facility_id as string,
          name: `${lastName} ${firstName}`.trim(),
          email: e.email as string | null,
          role: (e.role as 'admin' | 'manager' | 'employee') ?? 'employee',
          employment_type: (e.employment_type as 'full_time' | 'part_time') ?? 'full_time',
          default_start_time: e.default_start_time as string | null,
          default_end_time: e.default_end_time as string | null,
          pickup_transport_areas: (e.pickup_transport_areas as string[]) ?? [],
          dropoff_transport_areas: (e.dropoff_transport_areas as string[]) ?? [],
          qualifications: (e.qualifications as string[]) ?? [],
          is_qualified: (e.is_qualified as boolean) ?? false,
          is_driver: (e.is_driver as boolean) ?? false,
          is_attendant: (e.is_attendant as boolean) ?? false,
          shift_display_order: (e.shift_display_order as number | null) ?? null,
        } as StaffRow;
      });
      setStaff(staffRows);
      setChildren((childRes.data ?? []) as ChildRow[]);

      /* 当日 entries を transport_assignments と紐付ける際の対象 entry_id 集合 */
      const entryRows = (entryRes.data ?? []) as ScheduleEntryRow[];
      setEntries(entryRows);
      setShifts((shiftRes.data ?? []) as ShiftAssignmentRow[]);
      const entryIdSet = new Set(entryRows.map((e) => e.id));
      setTransportAssignments(
        ((transportRes.data ?? []) as TransportAssignmentRow[]).filter((t) =>
          entryIdSet.has(t.schedule_entry_id),
        ),
      );

      const settings = settingsRes.data ?? null;
      setPickupAreas((settings?.pickup_area_labels as AreaLabel[]) ?? []);
      setDropoffAreas((settings?.dropoff_area_labels as AreaLabel[]) ?? []);

      /* 学習記憶 fetch（B-1 で実装した API） */
      try {
        const oRes = await fetch(`/api/shifts/transport/child-order?facility_id=${facilityId}`);
        const oJson = oRes.ok ? await oRes.json() : { orders: [] };
        const memMap = new Map<string, Map<string, number>>();
        for (const r of (oJson.orders ?? []) as ChildOrderMemoryRow[]) {
          let inner = memMap.get(r.slot_signature);
          if (!inner) {
            inner = new Map();
            memMap.set(r.slot_signature, inner);
          }
          inner.set(r.child_id, r.display_order);
        }
        setOrderMemory(memMap);
      } catch {
        /* 学習記憶は非クリティカル。失敗しても画面は出す。 */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, facilityId, date]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  /* AreaLabel → emoji 引き */
  const allAreas = useMemo(() => [...pickupAreas, ...dropoffAreas], [pickupAreas, dropoffAreas]);
  const areaEmojiByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of allAreas) {
      m.set(`${a.emoji} ${a.name}`, a.emoji);
      m.set(a.name, a.emoji);
    }
    return m;
  }, [allAreas]);
  /* Phase 35: ラベル文字列 → AreaLabel.id 引き。signature 生成用 */
  const areaIdByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of allAreas) {
      if (!a.id) continue;
      m.set(`${a.emoji} ${a.name}`, a.id);
      m.set(a.name, a.id);
    }
    return m;
  }, [allAreas]);

  /* ---- 送迎スロットをタイムライン順に組み立て ---- */
  const slots: TransportSlot[] = useMemo(() => {
    const childById = new Map(children.map((c) => [c.id, c]));
    const list: TransportSlot[] = [];
    /* Phase 43: schedule_entries を主軸に走査。transport_assignment が存在しない児童も
       「担当未割当」として赤枠表示する（旧仕様は ta を回していたため未生成の子が消えていた）。 */
    const taByEntry = new Map(transportAssignments.map((t) => [t.schedule_entry_id, t]));

    for (const entry of entries) {
      if (entry.attendance_status === 'absent') continue;
      if (entry.attendance_status === 'leave') continue;
      if (!entry.pickup_time && !entry.dropoff_time) continue; /* 旧データ互換のお休み除外 */

      const child = childById.get(entry.child_id);
      if (!child) continue;
      const ta = taByEntry.get(entry.id);
      const spec = resolveEntryTransportSpec(entry, {
        child,
        pickupAreas,
        dropoffAreas,
      });

      if (entry.pickup_time) {
        const isSelf = entry.pickup_method === 'self';
        /* Phase 39: 保護者送迎は場所情報を出さない（送迎担当不要なので場所を見せても混乱の元） */
        const emoji =
          !isSelf && spec.pickup.areaLabel ? areaEmojiByLabel.get(spec.pickup.areaLabel) ?? null : null;
        const areaId = spec.pickup.areaLabel ? areaIdByLabel.get(spec.pickup.areaLabel) ?? null : null;
        const areaName =
          !isSelf && spec.pickup.areaLabel
            ? spec.pickup.areaLabel.replace(/^\S+\s+/, '').trim() || null
            : null;
        const pickupStaffIds = ta?.pickup_employee_ids ?? [];
        list.push({
          time: fmtTime(entry.pickup_time),
          direction: 'pickup',
          areaLabels: spec.pickup.areaLabel ? [spec.pickup.areaLabel] : [],
          areaIds: areaId ? [areaId] : [],
          children: [{ id: child.id, name: child.name, areaEmoji: emoji, areaName, grade: child.grade_type }],
          staffIds: isSelf ? [] : pickupStaffIds,
          /* 保護者送迎は「未割当」扱いしない。Phase 43: ta が無いケースも未割当扱い */
          isUnassigned:
            !isSelf &&
            ((ta?.is_unassigned ?? true) || (entry.pickup_method === 'pickup' && pickupStaffIds.length === 0)),
          isConfirmed: ta?.is_confirmed ?? false,
          isSelfTransport: isSelf,
        });
      }

      if (entry.dropoff_time) {
        const isSelf = entry.dropoff_method === 'self';
        /* Phase 39: 保護者送迎は場所情報を出さない */
        const emoji =
          !isSelf && spec.dropoff.areaLabel ? areaEmojiByLabel.get(spec.dropoff.areaLabel) ?? null : null;
        const areaId = spec.dropoff.areaLabel ? areaIdByLabel.get(spec.dropoff.areaLabel) ?? null : null;
        const areaName =
          !isSelf && spec.dropoff.areaLabel
            ? spec.dropoff.areaLabel.replace(/^\S+\s+/, '').trim() || null
            : null;
        const dropoffStaffIds = ta?.dropoff_employee_ids ?? [];
        list.push({
          time: fmtTime(entry.dropoff_time),
          direction: 'dropoff',
          areaLabels: spec.dropoff.areaLabel ? [spec.dropoff.areaLabel] : [],
          areaIds: areaId ? [areaId] : [],
          children: [{ id: child.id, name: child.name, areaEmoji: emoji, areaName, grade: child.grade_type }],
          staffIds: isSelf ? [] : dropoffStaffIds,
          /* Phase 43: ta が無い場合も未割当扱い */
          isUnassigned:
            !isSelf &&
            ((ta?.is_unassigned ?? true) ||
              (entry.dropoff_method === 'dropoff' && dropoffStaffIds.length === 0)),
          isConfirmed: ta?.is_confirmed ?? false,
          isSelfTransport: isSelf,
        });
      }
    }

    /* グルーピング:
       - 保護者送迎 slot: 同時刻+同方向+同エリア でまとめる（スタッフと混ざらないよう独立キー）
       - 担当者が割り当てられている slot: 同時刻+同方向+同じ担当者集合 でまとめる
         （エリア違いでも同じ担当者なら 1 ブロックに統合。areaLabels は配列で保持）
       - 未割当 slot: 同時刻+同方向+同エリア でまとめる（担当者が無いので area ベース） */
    const grouped = new Map<string, TransportSlot>();
    for (const s of list) {
      const hasStaff = s.staffIds.length > 0;
      const staffKey = s.isSelfTransport
        ? `P:${s.areaLabels.join('|')}`
        : hasStaff
          ? `S:${[...s.staffIds].sort().join(',')}`
          : `U:${s.areaLabels.join('|')}`;
      const key = `${s.time}|${s.direction}|${staffKey}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.children.push(...s.children);
        existing.staffIds = Array.from(new Set([...existing.staffIds, ...s.staffIds]));
        for (const al of s.areaLabels) {
          if (al && !existing.areaLabels.includes(al)) existing.areaLabels.push(al);
        }
        for (const aid of s.areaIds) {
          if (aid && !existing.areaIds.includes(aid)) existing.areaIds.push(aid);
        }
        existing.isUnassigned = existing.isUnassigned || s.isUnassigned;
      } else {
        grouped.set(key, {
          ...s,
          children: [...s.children],
          areaLabels: [...s.areaLabels],
          areaIds: [...s.areaIds],
        });
      }
    }

    const result = Array.from(grouped.values());
    result.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    /* Phase 35: 学習記憶を適用。signature ヒットした児童は memory の display_order 昇順、
       未登録の児童は元の並び（追加された順）で末尾に配置。 */
    for (const slot of result) {
      const sig = buildSlotSignature(slot);
      const mem = orderMemory.get(sig);
      if (!mem || mem.size === 0) continue;
      slot.children.sort((a, b) => {
        const oa = mem.get(a.id);
        const ob = mem.get(b.id);
        if (oa === undefined && ob === undefined) return 0;
        if (oa === undefined) return 1;
        if (ob === undefined) return -1;
        return oa - ob;
      });
    }

    return result;
  }, [children, entries, transportAssignments, pickupAreas, dropoffAreas, areaEmojiByLabel, areaIdByLabel, orderMemory]);

  const pickupSlots = useMemo(() => slots.filter((s) => s.direction === 'pickup'), [slots]);
  const dropoffSlots = useMemo(() => slots.filter((s) => s.direction === 'dropoff'), [slots]);

  /* ---- 出勤者一覧: 職員管理と同じ並び（shift_display_order ASC NULLS LAST, name でソート）
     Phase 50: 分割シフト対応。同一職員に複数セグメントがある場合、start/end を " / " 区切りで連結表示。 */
  const onDuty: OnDutyStaff[] = useMemo(() => {
    const segmentsByEmployeeId = new Map<string, ShiftAssignmentRow[]>();
    shifts
      .filter((sa) => sa.assignment_type === 'normal' && sa.start_time && sa.end_time)
      .forEach((sa) => {
        const arr = segmentsByEmployeeId.get(sa.employee_id);
        if (arr) arr.push(sa);
        else segmentsByEmployeeId.set(sa.employee_id, [sa]);
      });
    segmentsByEmployeeId.forEach((arr) =>
      arr.sort((a, b) => (a.segment_order ?? 0) - (b.segment_order ?? 0)),
    );
    /* shift_display_order ASC NULLS LAST → 同値時は氏名昇順 */
    const sortedStaff = [...staff].sort((a, b) => {
      const ao = a.shift_display_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.shift_display_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return staffDisplayName(a).localeCompare(staffDisplayName(b), 'ja');
    });
    return sortedStaff
      .filter((s) => segmentsByEmployeeId.has(s.id))
      .map((s) => {
        const segs = segmentsByEmployeeId.get(s.id)!;
        return {
          id: s.id,
          name: staffDisplayName(s),
          start: segs.map((sa) => fmtTime(sa.start_time)).join(' / '),
          end: segs.map((sa) => fmtTime(sa.end_time)).join(' / '),
        };
      });
  }, [shifts, staff]);

  const unassignedCount = slots.filter((s) => s.isUnassigned).length;
  /* 職員マーク内は表示名（短縮）。 */
  const staffNameById = useMemo(
    () => new Map(staff.map((s) => [s.id, staffDisplayName(s)])),
    [staff],
  );

  /* Phase 35: 並び替え結果を local state に反映 + サーバーに保存（楽観更新）。 */
  const persistChildOrder = useCallback(
    async (signature: string, orderedChildIds: string[]) => {
      setOrderMemory((prev) => {
        const next = new Map(prev);
        const inner = new Map<string, number>();
        orderedChildIds.forEach((id, idx) => inner.set(id, idx));
        next.set(signature, inner);
        return next;
      });
      if (!facilityId) return;
      try {
        await fetch('/api/shifts/transport/child-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facility_id: facilityId,
            signature,
            orders: orderedChildIds.map((id, idx) => ({ child_id: id, display_order: idx })),
          }),
        });
      } catch {
        /* ネットワーク失敗時はサイレント。次回 fetch で再同期される。 */
      }
    },
    [facilityId],
  );

  /* 利用児童数: 当日 entries のうち「実際に来所する」児童のユニーク数。
     欠席・お休み（attendance_status='absent'/'leave' または times 両方 null）を除外。 */
  const activeChildCount = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) {
      if (e.attendance_status === 'absent') continue;
      if (e.attendance_status === 'leave') continue;
      if (!e.pickup_time && !e.dropoff_time) continue;
      ids.add(e.child_id);
    }
    return ids.size;
  }, [entries]);

  /**
   * ブラウザ標準の印刷ダイアログを起動。
   * ユーザーはここから「PDF として保存」を選ぶ（全ブラウザ共通）。
   * 日本語・絵文字はブラウザ標準フォントで描画される。
   */
  const handlePrint = () => {
    const original = document.title;
    document.title = `日次出力_${date}`;
    const restore = () => {
      document.title = original;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  };

  const dateObj = new Date(date);
  const monthLabel = `${dateObj.getMonth() + 1}月`;
  const dayLabel = `${dateObj.getDate()}`;
  const weekLabel = ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()];
  /* Phase 58-fix: 日次出力の見出しも土日祝で色変化 */
  const dayOfWeek = dateObj.getDay();
  const isHolidayDay = isJpHoliday(date);
  const holidayName = isHolidayDay ? jpHolidayName(date) : null;
  const headingColor =
    isHolidayDay || dayOfWeek === 0 ? 'var(--red)' : dayOfWeek === 6 ? 'var(--accent)' : 'var(--ink)';

  return (
    /* 親レイアウト (admin/manager) の p-6 lg:p-8 を打ち消して縦横をフルに使う。
       シフト表 / 利用表 / 送迎表 と padding を統一。 */
    <div className="flex flex-col h-full overflow-hidden -m-6 lg:-m-8 daily-output-root">
      {/* 印刷用 CSS: 印刷時はサイドバー・ヘッダー・ナビボタン非表示、A3縦に最適化 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              /* Phase 45 reset: 灰色背景は許容（紙面内でうっすら出るが、コンテンツ可視性を最優先）。 */
              @page { size: A3 portrait; margin: 10mm; }
              html, body {
                background: #fff !important;
                height: auto !important;
                overflow: visible !important;
                min-width: 1100px !important;
              }
              body > div {
                display: block !important;
                height: auto !important;
                min-height: 0 !important;
                overflow: visible !important;
                min-width: 1100px !important;
              }
              main {
                width: 100% !important;
                height: auto !important;
                overflow: visible !important;
              }
              [style*="var(--bg)"],
              main {
                background: #fff !important;
                background-color: #fff !important;
              }
              aside, header, .print-hide {
                display: none !important;
              }
              .daily-output-root,
              .daily-output-root > div {
                height: auto !important;
                overflow: visible !important;
                padding: 0 !important;
                background: #fff !important;
              }
              .whiteboard-frame {
                box-shadow: none !important;
                max-width: none !important;
                margin: 0 !important;
              }
              .transport-block {
                page-break-inside: avoid;
                break-inside: avoid;
              }
              * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }

            /* モバイル画面 (<1024px) のみ縦積みに切り替え。
               @media screen スコープなので @media print には一切影響しない。
               元の 2-col レイアウト (minmax(0,1fr) 320px) は PC 画面/印刷で維持される。 */
            @media screen and (max-width: 1023px) {
              .whiteboard-grid {
                grid-template-columns: 1fr !important;
                gap: 1.25rem !important;
              }
              .whiteboard-frame {
                padding: 1rem !important;
              }
            }
          `,
        }}
      />

      {/* 日付ステッパ + 印刷ボタンを 1 行で。利用表/シフト表/送迎表 と統一したスペーシング */}
      <div className="px-6 pt-1 pb-1.5 print-hide flex items-center justify-between gap-3 flex-wrap">
        <DateStepperFull value={date} onChange={setDate} />
        <Button variant="primary" onClick={handlePrint}>
          🖨 印刷 / PDF保存
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-3" style={{ background: 'var(--white)' }}>
        {error && (
          <div
            className="mb-2 px-4 py-2 rounded"
            style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}
          >
            {error}
          </div>
        )}

        {/* 未割当があるときだけ画面上に警告を出す（日付はボード内カードに表示） */}
        {unassignedCount > 0 && (
          <div className="mb-3 flex items-center gap-2 flex-wrap print-hide">
            <span
              className="text-xs font-bold px-2 py-1 rounded"
              style={{ background: 'var(--red)', color: 'var(--white)' }}
            >
              未割当 {unassignedCount}件
            </span>
          </div>
        )}

        {loading ? (
          <div className="h-96 flex items-center justify-center text-sm" style={{ color: 'var(--ink-3)' }}>
            読み込み中...
          </div>
        ) : (
          /* ホワイトボード本体: A3 縦に合わせた最大幅。常時 2-col（左=送迎, 右=勤務+休憩） */
          <div
            className="rounded-lg p-4 lg:p-6 whiteboard-frame mx-auto"
            style={{
              background: 'var(--white)',
              border: '2px solid var(--ink-2)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              maxWidth: '1100px',
            }}
          >
            <div
              className="grid gap-5 lg:gap-6 whiteboard-grid"
              style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}
            >
              {/* 左カラム: 日付カード + 送迎タイムライン */}
              <div>
                <div className="flex items-center gap-4 mb-4 flex-wrap">
                  {/* 日付カード（横並び: 4月20日(月) を 1 行で） */}
                  <div
                    className="shrink-0"
                    style={{
                      border: '2px solid var(--ink)',
                      borderRadius: '6px',
                      padding: '10px 18px',
                    }}
                  >
                    <span
                      className="text-2xl font-black whitespace-nowrap"
                      style={{ color: headingColor }}
                      title={holidayName ?? undefined}
                    >
                      {monthLabel}
                      {dayLabel}日({weekLabel})
                      {holidayName && (
                        <span className="text-sm font-semibold ml-2" style={{ color: 'var(--red)' }}>
                          {holidayName}
                        </span>
                      )}
                    </span>
                  </div>
                  <div>
                    <div className="text-base font-black" style={{ color: 'var(--ink-2)' }}>
                      予定ホワイトボード
                    </div>
                    <div className="text-base font-bold mt-1" style={{ color: 'var(--ink)' }}>
                      出勤者 {onDuty.length}名・利用児童 {activeChildCount}名
                    </div>
                  </div>
                </div>

                {slots.length === 0 ? (
                  <div
                    className="p-6 rounded text-sm text-center"
                    style={{ border: '1px dashed var(--rule)', color: 'var(--ink-3)' }}
                  >
                    この日の送迎予定はありません
                  </div>
                ) : (
                  <>
                    {/* 迎セクション: 上下に太線。3 列レイアウト (col1=1件, col2=2件まで, col3=5件まで) */}
                    <DirectionSection heading="迎（来所）" count={pickupSlots.length} accent="var(--accent)">
                      {pickupSlots.length === 0 ? (
                        <EmptyDirection label="迎" />
                      ) : (
                        <ThreeColGrid
                          slots={pickupSlots}
                          staffNameById={staffNameById}
                          keyPrefix="p"
                          direction="pickup"
                          onReorderChildren={persistChildOrder}
                        />
                      )}
                    </DirectionSection>

                    {/* 送セクション: 上下に太線。3 列レイアウト (同上) */}
                    <DirectionSection heading="送（退所）" count={dropoffSlots.length} accent="var(--green)">
                      {dropoffSlots.length === 0 ? (
                        <EmptyDirection label="送" />
                      ) : (
                        <ThreeColGrid
                          slots={dropoffSlots}
                          staffNameById={staffNameById}
                          keyPrefix="d"
                          direction="dropoff"
                          onReorderChildren={persistChildOrder}
                        />
                      )}
                    </DirectionSection>
                  </>
                )}
              </div>

              {/* 右カラム: 本日の出勤 + 休憩セクション */}
              <div className="flex flex-col gap-4">
                <section>
                  <h3
                    className="text-base font-black pb-1 mb-2"
                    style={{ color: 'var(--ink)', borderBottom: '2.5px solid var(--ink)' }}
                  >
                    本日の出勤
                  </h3>
                  {onDuty.length === 0 ? (
                    <div className="text-sm" style={{ color: 'var(--ink-3)' }}>
                      出勤者はいません
                    </div>
                  ) : (
                    <ul className="flex flex-col">
                      {onDuty.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-3 py-1.5"
                          style={{ borderBottom: '1px dashed var(--rule)' }}
                        >
                          <span
                            className="text-base font-black whitespace-nowrap"
                            style={{ color: 'var(--ink)' }}
                          >
                            {s.name}
                          </span>
                          <span
                            className="text-sm font-bold tracking-tight whitespace-nowrap"
                            style={{ color: 'var(--ink-2)' }}
                          >
                            {s.start}〜{s.end}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3
                    className="text-base font-black pb-1 mb-2"
                    style={{ color: 'var(--ink)', borderBottom: '2.5px solid var(--ink)' }}
                  >
                    休憩
                  </h3>
                  <div
                    className="p-3 rounded text-sm font-semibold"
                    style={{
                      border: '1px dashed var(--rule)',
                      color: 'var(--ink-2)',
                      minHeight: '70px',
                      lineHeight: '1.5',
                    }}
                  >
                    休憩時間をずらす
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== 迎/送セクション: 上下に太線を引いて完全分離 ===== */
function DirectionSection({
  heading,
  count,
  accent,
  children,
}: {
  heading: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 direction-section">
      <div
        className="flex items-baseline gap-2 px-2 py-1.5 direction-section-header"
        style={{
          borderTop: `6px solid ${accent}`,
          borderBottom: `2px solid ${accent}`,
          marginBottom: '10px',
        }}
      >
        <span className="text-xl font-black" style={{ color: accent }}>
          {heading}
        </span>
        <span className="text-sm font-bold" style={{ color: 'var(--ink-3)' }}>
          {count}便
        </span>
      </div>
      {children}
      <div
        className="direction-section-footer"
        style={{ borderBottom: `6px solid ${accent}`, marginTop: '10px' }}
      />
    </div>
  );
}

function EmptyDirection({ label }: { label: string }) {
  return (
    <div
      className="p-4 rounded text-xs text-center"
      style={{ border: '1px dashed var(--rule)', color: 'var(--ink-3)' }}
    >
      {label}の便はありません
    </div>
  );
}

/** 方向別のブロック配置ルール:
 *   迎え: 1 / 1 / 2 / 3 / 3 / 3... （1 行目 1件、2 行目 1件、3 行目 2件、4 行目以降 3件ずつ）
 *   送り: 2 / 3 / 3 / 3...         （1 行目 2件、2 行目以降 3件ずつ） */
function slotCell(i: number, direction: 'pickup' | 'dropoff'): { col: number; row: number } {
  if (direction === 'pickup') {
    if (i === 0) return { col: 1, row: 1 };
    if (i === 1) return { col: 1, row: 2 };
    if (i === 2) return { col: 1, row: 3 };
    if (i === 3) return { col: 2, row: 3 };
    /* i >= 4: row 4 から 3列ずつ */
    const r = 4 + Math.floor((i - 4) / 3);
    const c = ((i - 4) % 3) + 1;
    return { col: c, row: r };
  }
  /* dropoff */
  if (i === 0) return { col: 1, row: 1 };
  if (i === 1) return { col: 2, row: 1 };
  /* i >= 2: row 2 から 3列ずつ */
  const r = 2 + Math.floor((i - 2) / 3);
  const c = ((i - 2) % 3) + 1;
  return { col: c, row: r };
}

function ThreeColGrid({
  slots,
  staffNameById,
  keyPrefix,
  direction,
  onReorderChildren,
}: {
  slots: TransportSlot[];
  staffNameById: Map<string, string>;
  keyPrefix: string;
  direction: 'pickup' | 'dropoff';
  onReorderChildren: (signature: string, orderedChildIds: string[]) => void;
}) {
  return (
    <div
      className="grid gap-x-6 gap-y-5"
      style={{
        gridTemplateColumns: 'repeat(3, max-content)',
        gridAutoRows: 'min-content',
        justifyContent: 'start',
      }}
    >
      {slots.map((s, i) => {
        const pos = slotCell(i, direction);
        return (
          <div
            key={`${keyPrefix}-${s.time}-${s.areaLabels.join(',')}-${i}`}
            style={{ gridColumn: pos.col, gridRow: pos.row }}
          >
            <TransportBlock slot={s} staffNameById={staffNameById} onReorderChildren={onReorderChildren} />
          </div>
        );
      })}
    </div>
  );
}

/* ===== 時刻ブロック: 画像の罫線で囲まれた一枠に相当 ===== */
function TransportBlock({
  slot,
  staffNameById,
  onReorderChildren,
}: {
  slot: TransportSlot;
  staffNameById: Map<string, string>;
  onReorderChildren: (signature: string, orderedChildIds: string[]) => void;
}) {
  const headerColor = slot.direction === 'pickup' ? 'var(--accent)' : 'var(--green)';
  const signature = buildSlotSignature(slot);

  /* DnD センサ: マウス + タッチ + キーボード。activationConstraint でクリックと誤認しない */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = slot.children.findIndex((c) => c.id === active.id);
    const newIdx = slot.children.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(slot.children, oldIdx, newIdx);
    onReorderChildren(
      signature,
      reordered.map((c) => c.id),
    );
  };

  return (
    <div
      className="flex flex-col transport-block"
      style={{
        border: `2px solid ${slot.isUnassigned ? 'var(--red)' : 'var(--ink-2)'}`,
        background: slot.isUnassigned ? 'var(--red-pale)' : 'var(--white)',
        borderRadius: '6px',
        flex: '0 0 auto',
        minWidth: 0,
        maxWidth: '420px',
      }}
    >
      {/* Phase 38: ヘッダーは「時刻 発 + 担当者チップ」(旧: 場所名)。
          場所名は児童バッジ上部に併記する形に移動した。 */}
      <div
        className="px-3 py-2 flex items-center gap-2 flex-wrap"
        style={{ borderBottom: '1.5px solid var(--ink-2)' }}
      >
        <span className="text-2xl font-black leading-none" style={{ color: headerColor }}>
          {slot.time}
        </span>
        <span className="text-base font-black" style={{ color: headerColor }}>
          発
        </span>
        <div className="flex flex-wrap gap-1.5 ml-1">
          {slot.isSelfTransport ? (
            <span
              className="text-base font-black px-2 py-0.5 whitespace-nowrap"
              style={{
                background: 'var(--white)',
                border: '2px dashed var(--ink-3)',
                borderRadius: '4px',
                color: 'var(--ink-2)',
              }}
              title="保護者による送迎のため、担当職員の割り当ては不要です"
            >
              👪 保護者
            </span>
          ) : slot.isUnassigned ? (
            <span className="text-base font-black" style={{ color: 'var(--red)' }}>
              ⚠ 担当未割当
            </span>
          ) : slot.staffIds.length === 0 ? null : (
            slot.staffIds.map((id) => (
              <span
                key={id}
                className="text-base font-black staff-box whitespace-nowrap"
                style={{
                  background: 'var(--white)',
                  border: '2px solid var(--ink-2)',
                  borderRadius: '4px',
                  color: 'var(--ink)',
                  minWidth: '56px',
                  padding: '2px 10px',
                  textAlign: 'center',
                }}
              >
                {staffNameById.get(id) ?? id}
              </span>
            ))
          )}
        </div>
      </div>

      {/* 本体: 児童バッジのみ。各バッジ上部に「emoji 場所名」を表示 */}
      <div className="p-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slot.children.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-wrap gap-2">
              {slot.children.map((c) => (
                <SortableChildBadge key={c.id} child={c} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

/* ===== Phase 35: 並び替え可能な児童バッジ ===== */
function SortableChildBadge({
  child,
}: {
  child: { id: string; name: string; grade: GradeType; areaEmoji: string | null; areaName: string | null };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: child.id,
  });
  const col = getGradeColors(child.grade);
  const nameLines = splitChildName(child.name);
  /* Phase 38: バッジ自身が場所アイコンを持つことで DnD 並び替え時に場所も追従する */
  const wrapperStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    touchAction: 'none',
    userSelect: 'none',
    position: 'relative',
  };
  const badgeStyle: React.CSSProperties = {
    background: col.bg,
    border: `2px solid ${col.border}`,
    borderRadius: '999px',
    /* Phase 43: 文字を大きくしたのでバッジも 64→76 に拡大 */
    minWidth: '76px',
    minHeight: '76px',
    lineHeight: '1.15',
    padding: '6px 8px',
    cursor: 'grab',
  };
  return (
    <div
      ref={setNodeRef}
      className="flex flex-col items-center child-mark"
      style={wrapperStyle}
      title={child.name}
      {...attributes}
      {...listeners}
    >
      {(child.areaEmoji || child.areaName) && (
        <span
          aria-label="送迎エリア"
          className="leading-none whitespace-nowrap text-center"
          style={{
            fontSize: '0.95rem',
            marginBottom: '4px',
            color: 'var(--ink-2)',
            fontWeight: 700,
          }}
        >
          {child.areaEmoji ?? ''} {child.areaName ?? ''}
        </span>
      )}
      <div className="flex flex-col items-center justify-center" style={badgeStyle}>
        {nameLines.map((line, i) => (
          <span
            key={i}
            className="font-black whitespace-nowrap"
            style={{ color: col.text, fontSize: '1.05rem', lineHeight: 1.15 }}
          >
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}
