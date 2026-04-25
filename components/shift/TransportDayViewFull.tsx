'use client';

import React, { useState, useEffect, useRef } from 'react';
import { openInGoogleMaps } from '@/lib/utils/googleMaps';
import type { TransportColumnKey } from '@/lib/constants';
import { DEFAULT_TRANSPORT_COLUMN_ORDER } from '@/lib/constants';
import { staffDisplayName } from '@/lib/shift-utils';
import type { ChildAreaEligibleStaffRow } from '@/lib/types';

/**
 * 日別送迎表ビュー
 * - 行: 児童名（利用予定のある児童）
 * - 列: 迎え時間 / 迎え担当 / 送り時間 / 送り担当
 * - 担当はドロップダウンで変更可能（Phase 26: 変更は pending state に蓄積され、親の「保存」で一括反映）
 * - 未割り当て（is_unassigned）は赤ハイライト
 * - Phase 17: 児童名クリックで詳細行を展開し、迎/送の場所をリスト表示
 * - Phase 26:
 *   - 担当候補を「出勤中 かつ end_time >= transportMinEndTime」で絞り込み
 *   - pickup/dropoff method === 'self' のときは「👪 保護者送迎」表記で担当欄を非表示
 *   - セル時間の下に「エリア絵文字 + 名称」と「住所」を明示表示
 */

type TransportChild = {
  id: string;
  scheduleEntryId: string;
  name: string;
  pickupTime: string | null;
  dropoffTime: string | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupAreaLabel: string | null;
  dropoffAreaLabel: string | null;
  /** Phase 60: エリア対応可否チェック用。対応外職員に option 側で「⚠対応外」マーカーを出す */
  pickupAreaId: string | null;
  dropoffAreaId: string | null;
  pickupStaffIds: string[];
  dropoffStaffIds: string[];
  isUnassigned: boolean;
  /** Phase 26: 'self' なら保護者送迎（担当不要） */
  pickupMethod: 'pickup' | 'self';
  dropoffMethod: 'dropoff' | 'self';
  /** Phase 29+: 児童専用エリアの登録対象として参照する child.id */
  childId: string;
};

type TransportStaff = {
  id: string;
  name: string;
  /** Phase 28 F案: 送迎表 select の短縮表示名（最大3文字）。未登録なら name の先頭3文字 */
  display_name?: string | null;
  /** Phase 26: 当日の勤務終了時刻（"HH:MM:SS" or "HH:MM"）。null なら欠勤/候補外 */
  endTime: string | null;
  /** Phase 60: 当日の出勤セグメント（分割シフト対応）。便時刻がいずれかのセグメント内に
      収まるかで候補判定する。空配列は欠勤扱い。 */
  segments: { startTime: string; endTime: string }[];
  /** Phase 27: 迎で担当しているエリア絵文字。重複なし */
  pickupAreaMarks: string[];
  /** Phase 27: 送で担当しているエリア絵文字。重複なし */
  dropoffAreaMarks: string[];
  /** Phase 59: 運転手フラグ。左スロット候補に限定する判定用 */
  isDriver: boolean;
  /** Phase 59: 付き添いフラグ。右スロット候補に含める判定用 */
  isAttendant: boolean;
  /** Phase 60: 対応エリア（AreaLabel.id）。迎担当は pickup、送は dropoff を参照。
      どちらも空なら transport_areas（旧統一カラム）にフォールバック。 */
  pickupAreaIds: string[];
  dropoffAreaIds: string[];
};

type TransportDayViewProps = {
  children: TransportChild[];
  /** 全職員（セル内 select 用）。Phase 26: 当日出勤かつ endTime >= minEndTime のみ候補 */
  availableStaff: TransportStaff[];
  /** Phase 26: "HH:MM" 形式の最低退勤時刻（この時刻以降に退勤する職員のみ候補） */
  transportMinEndTime: string;
  /** Phase 60: テナント共通 AreaLabel.id 一覧。areaId がここに含まれなければ child-specific として扱う。 */
  tenantAreaIds: string[];
  /** Phase 60: 児童専用エリアごとの担当可能職員（同テナント全件）。 */
  childAreaEligibleStaff: ChildAreaEligibleStaffRow[];
  onStaffChange: (
    scheduleEntryId: string,
    field: 'pickup' | 'dropoff',
    staffIds: string[]
  ) => void;
  disabled?: boolean;
  /** Phase 58: 当日が「保存済み」か。false = 自動割り当て状態で StaffSelect をグレー表示 */
  dayLocked?: boolean;
  /** Phase 28: 列の並び順（児童名は常に先頭固定なので含めない）。未指定は DEFAULT_TRANSPORT_COLUMN_ORDER */
  columnOrder?: TransportColumnKey[];
  /** Phase 28: 列を並び替えたときに呼ばれる。テナント設定へ保存する親側で処理 */
  onColumnReorder?: (order: TransportColumnKey[]) => void;
  /**
   * Phase 29+: 送迎表から「この児童専用エリア」を直接登録するコールバック。
   * 未指定（viewer など権限なし）の場合は登録ボタン自体を出さない。
   */
  onAddCustomArea?: (
    childId: string,
    direction: 'pickup' | 'dropoff',
    area: { emoji: string; name: string; time: string; address: string },
  ) => Promise<void>;
};

/** "HH:MM" または "HH:MM:SS" 形式 → 分数 */
function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** "HH:MM:SS" や "HH:MM" を "HH:MM" 表示に正規化（秒を捨てる） */
function formatHourMinute(t: string | null): string {
  if (!t) return '-';
  const parts = t.split(':');
  if (parts.length < 2) return t;
  return `${parts[0]}:${parts[1]}`;
}

/**
 * Phase 47 (①): その行が属する「便（トリップ）」のマーク集合を計算する。
 * ルール:
 *  - 同じ direction
 *  - 担当職員が 1 人以上重なる
 *  - 時刻差が 30 分未満
 * を満たす行同士は「同じ便」とみなし、それぞれの行のエリアマークをすべて合体して表示する。
 *
 * これにより:
 *  - 16:00 🌳 と 16:00 🏭 を同じ職員が担当 → 両行とも 🌳🏭 表記（=同じ便で複数エリア回る）
 *  - 13:20 🐻 と 14:30 ✏（70 分差） → 別便扱い、🐻 行は 🐻 のみ、✏ 行は ✏ のみ
 * となり、ユーザーの「マーク合体」と「別便分離」の両ルールが満たされる。
 */
function computeTripMarks(
  row: TransportChild,
  all: TransportChild[],
  direction: 'pickup' | 'dropoff',
): string[] {
  const myTime = direction === 'pickup' ? row.pickupTime : row.dropoffTime;
  const myStaff = direction === 'pickup' ? row.pickupStaffIds : row.dropoffStaffIds;
  const myEmoji = splitAreaLabel(
    direction === 'pickup' ? row.pickupAreaLabel : row.dropoffAreaLabel,
  ).emoji;
  const myMin = timeToMinutes(myTime);
  /* 時刻も担当も無いときは行のマークだけ返す */
  if (myMin === null || myStaff.filter((id) => !!id).length === 0) {
    return myEmoji ? [myEmoji] : [];
  }
  const out: string[] = [];
  for (const other of all) {
    const oTime = direction === 'pickup' ? other.pickupTime : other.dropoffTime;
    const oStaff = direction === 'pickup' ? other.pickupStaffIds : other.dropoffStaffIds;
    const oEmoji = splitAreaLabel(
      direction === 'pickup' ? other.pickupAreaLabel : other.dropoffAreaLabel,
    ).emoji;
    if (!oEmoji) continue;
    const oMin = timeToMinutes(oTime);
    if (oMin === null) continue;
    if (Math.abs(oMin - myMin) >= 30) continue; /* 30 分以上離れたら別便 */
    /* 担当職員に 1 人以上の共通があるか */
    const overlap = oStaff.some((id) => id && myStaff.includes(id));
    if (!overlap) continue;
    if (!out.includes(oEmoji)) out.push(oEmoji);
  }
  /* 自分のマークが out に含まれていなければ先頭に追加（時間/担当が一致しないケースの保険） */
  if (myEmoji && !out.includes(myEmoji)) out.unshift(myEmoji);
  return out;
}

/** エリアラベル "🏠 藤江" から絵文字と名前を分離 */
function splitAreaLabel(label: string | null): { emoji: string | null; name: string | null } {
  if (!label) return { emoji: null, name: null };
  /* 最初の空白で分ける: "🏠 藤江" → emoji="🏠", name="藤江" */
  const trimmed = label.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { emoji: null, name: trimmed };
  return { emoji: trimmed.slice(0, spaceIdx), name: trimmed.slice(spaceIdx + 1).trim() };
}

const SectionLabel = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color }} />
    <span>{children}</span>
  </span>
);

export default function TransportDayView({
  children,
  availableStaff,
  transportMinEndTime,
  tenantAreaIds,
  childAreaEligibleStaff,
  onStaffChange,
  disabled = false,
  dayLocked = false,
  columnOrder,
  onColumnReorder,
  onAddCustomArea,
}: TransportDayViewProps) {
  /* Phase 60: 対応エリア判定を 2 段階化するためのルックアップ。
     - tenantAreaSet に含まれる → staff.pickupAreaIds / dropoffAreaIds で判定（既存ロジック）
     - 含まれない（child-specific）→ eligibleStaffByAreaDir map で判定 */
  const tenantAreaSet = React.useMemo(() => new Set(tenantAreaIds), [tenantAreaIds]);
  const eligibleStaffByAreaDir = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of childAreaEligibleStaff) {
      const k = `${r.area_id}|${r.direction}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(r.employee_id);
    }
    return m;
  }, [childAreaEligibleStaff]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /* Phase 28: 列並び替え DnD 用のドラッグ中インデックス（columnOrder 上の位置） */
  const [dragCol, setDragCol] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);

  /* Phase 60: 迎/送を統一ルールで候補抽出。
     条件: 便時刻が職員のいずれかのセグメントに収まり、かつ 退勤時刻 >= 便時刻 + 30 分。
     これによりテナント設定の transportMinEndTime は不要に。props は互換維持のため残す。 */
  const TRANSPORT_BUFFER_MINUTES = 30;
  const eligibleStaffMap = React.useMemo(() => {
    const map = new Map<string | null, TransportStaff[]>();
    const compute = (tripTime: string | null) => {
      const tripMin = timeToMinutes(tripTime);
      return availableStaff.filter((s) => {
        if (s.segments.length === 0) return false;
        if (tripMin === null) return true;
        return s.segments.some((seg) => {
          const start = timeToMinutes(seg.startTime);
          const end = timeToMinutes(seg.endTime);
          if (start === null || end === null) return false;
          return start <= tripMin && tripMin + TRANSPORT_BUFFER_MINUTES <= end;
        });
      });
    };
    for (const child of children) {
      if (!map.has(child.pickupTime)) map.set(child.pickupTime, compute(child.pickupTime));
      if (!map.has(child.dropoffTime)) map.set(child.dropoffTime, compute(child.dropoffTime));
    }
    return map;
  }, [children, availableStaff]);

  const pickupEligibleFor = React.useCallback((time: string | null) => eligibleStaffMap.get(time) ?? [], [eligibleStaffMap]);
  const dropoffEligibleFor = React.useCallback((time: string | null) => eligibleStaffMap.get(time) ?? [], [eligibleStaffMap]);
  void transportMinEndTime;

  /* 行ごとの tripMarks 計算が O(N^2) で重いため、children 変更時に一括で前計算する */
  const tripMarksMap = React.useMemo(() => {
    const map = new Map<string, { pickup: string[]; dropoff: string[] }>();
    for (const child of children) {
      map.set(child.scheduleEntryId, {
        pickup: computeTripMarks(child, children, 'pickup'),
        dropoff: computeTripMarks(child, children, 'dropoff'),
      });
    }
    return map;
  }, [children]);

  /* columnOrder が未指定 or 既知キー以外が混入している場合のフォールバック */
  const effectiveOrder: TransportColumnKey[] = React.useMemo(() => {
    const known: TransportColumnKey[] = [
      'pickup_time',
      'pickup_location',
      'pickup_staff',
      'dropoff_time',
      'dropoff_location',
      'dropoff_staff',
    ];
    const base = columnOrder ?? DEFAULT_TRANSPORT_COLUMN_ORDER;
    /* 未知キーを除き、欠けているキーを末尾に補完 */
    const filtered = base.filter((k) => known.includes(k));
    const missing = known.filter((k) => !filtered.includes(k));
    return [...filtered, ...missing];
  }, [columnOrder]);

  if (children.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
          この日の利用予定はありません
        </p>
      </div>
    );
  }

  /* 児童名 + 並び替え可能列数 = 合計列数（展開行の colSpan 用） */
  const colSpan = 1 + effectiveOrder.length;


  /* Phase 27 (layout revised): ダーク帯 + 方向別アクセントカラーでセクション感を出す。
     迎=accent(青)、送=green(緑)でヘッダーにドット記号を入れて視線を誘導。 */
  const PICK_ACCENT = 'var(--accent)';
  const DROP_ACCENT = 'var(--green)';
  const headerBase: React.CSSProperties = {
    background: 'var(--ink)',
    color: '#fff',
    fontSize: '0.7rem',
    letterSpacing: '0.06em',
    /* Phase 28: 左右パディングを限界まで削る */
    padding: '8px 4px',
    fontWeight: 700,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    /* Phase 28: 列区切りの縦線（ヘッダーも含めて全列右端に 1px） */
    borderRight: '1px solid rgba(255,255,255,0.15)',
  };
  /* Phase 28: データセルの縦区切り（全列右端に薄い線） */
  const cellBorderRight = '1px solid var(--rule)';

  /* Phase 28: 列のメタデータ + セル描画。ヘッダー/セルどちらもここから読む */
  type ColMeta = {
    header: React.ReactNode;
    minWidth: string;
    textAlign: 'left' | 'center';
    accent: string;
    renderCell: (child: TransportChild, isExpanded: boolean) => React.ReactNode;
  };
  const colMeta: Record<TransportColumnKey, ColMeta> = {
    pickup_time: {
      header: <SectionLabel color={PICK_ACCENT}>迎 時刻</SectionLabel>,
      minWidth: '70px',
      textAlign: 'center',
      accent: PICK_ACCENT,
      renderCell: (child, isExpanded) => (
        <TimeCell time={child.pickupTime} timeColor={PICK_ACCENT} isExpanded={isExpanded} />
      ),
    },
    pickup_location: {
      header: <SectionLabel color={PICK_ACCENT}>迎 場所</SectionLabel>,
      minWidth: '115px',
      textAlign: 'left',
      accent: PICK_ACCENT,
      renderCell: (child, isExpanded) => (
        <LocationCellInline
          /* Phase 44: 保護者送迎は場所欄を非表示（「保護者なのに自宅?」と混乱するため） */
          areaLabel={child.pickupMethod === 'self' ? null : child.pickupAreaLabel}
          location={child.pickupMethod === 'self' ? null : child.pickupLocation}
          accentColor={PICK_ACCENT}
          isExpanded={isExpanded}
        />
      ),
    },
    pickup_staff: {
      header: <SectionLabel color={PICK_ACCENT}>迎 担当</SectionLabel>,
      minWidth: '220px',
      textAlign: 'left',
      accent: PICK_ACCENT,
      renderCell: (child, isExpanded) => (
        <td
          className="px-1 py-1.5 align-top group-hover:!bg-[var(--accent-pale)] transition-colors"
          style={{
            borderBottom: isExpanded ? 'none' : '1px solid var(--rule)',
            borderRight: cellBorderRight,
          }}
        >
          {child.pickupMethod === 'self' ? (
            <SelfTransportBadge />
          ) : (
            <StaffSelect
              staffIds={child.pickupStaffIds}
              availableStaff={pickupEligibleFor(child.pickupTime)}
              onChange={(ids) => onStaffChange(child.scheduleEntryId, 'pickup', ids)}
              disabled={disabled}
              dayLocked={dayLocked}
              direction="pickup"
              rowAreaEmoji={splitAreaLabel(child.pickupAreaLabel).emoji}
              rowAreaId={child.pickupAreaId}
              isAreaCovered={(staffId, sAreas) => {
                if (!child.pickupAreaId) return true;
                if (tenantAreaSet.has(child.pickupAreaId)) {
                  return sAreas.includes(child.pickupAreaId);
                }
                return !!eligibleStaffByAreaDir
                  .get(`${child.pickupAreaId}|pickup`)
                  ?.has(staffId);
              }}
              tripMarks={tripMarksMap.get(child.scheduleEntryId)?.pickup ?? []}
            />
          )}
        </td>
      ),
    },
    dropoff_time: {
      header: <SectionLabel color={DROP_ACCENT}>送 時刻</SectionLabel>,
      minWidth: '70px',
      textAlign: 'center',
      accent: DROP_ACCENT,
      renderCell: (child, isExpanded) => (
        <TimeCell time={child.dropoffTime} timeColor={DROP_ACCENT} isExpanded={isExpanded} />
      ),
    },
    dropoff_location: {
      header: <SectionLabel color={DROP_ACCENT}>送 場所</SectionLabel>,
      minWidth: '115px',
      textAlign: 'left',
      accent: DROP_ACCENT,
      renderCell: (child, isExpanded) => (
        <LocationCellInline
          /* Phase 44: 保護者送迎は場所欄を非表示 */
          areaLabel={child.dropoffMethod === 'self' ? null : child.dropoffAreaLabel}
          location={child.dropoffMethod === 'self' ? null : child.dropoffLocation}
          accentColor={DROP_ACCENT}
          isExpanded={isExpanded}
        />
      ),
    },
    dropoff_staff: {
      header: <SectionLabel color={DROP_ACCENT}>送 担当</SectionLabel>,
      minWidth: '220px',
      textAlign: 'left',
      accent: DROP_ACCENT,
      renderCell: (child, isExpanded) => (
        <td
          className="px-1 py-1.5 align-top group-hover:!bg-[var(--accent-pale)] transition-colors"
          style={{
            borderBottom: isExpanded ? 'none' : '1px solid var(--rule)',
            borderRight: cellBorderRight,
          }}
        >
          {child.dropoffMethod === 'self' ? (
            <SelfTransportBadge />
          ) : (
            <StaffSelect
              staffIds={child.dropoffStaffIds}
              availableStaff={dropoffEligibleFor(child.dropoffTime)}
              onChange={(ids) => onStaffChange(child.scheduleEntryId, 'dropoff', ids)}
              disabled={disabled}
              dayLocked={dayLocked}
              direction="dropoff"
              rowAreaEmoji={splitAreaLabel(child.dropoffAreaLabel).emoji}
              rowAreaId={child.dropoffAreaId}
              isAreaCovered={(staffId, sAreas) => {
                if (!child.dropoffAreaId) return true;
                if (tenantAreaSet.has(child.dropoffAreaId)) {
                  return sAreas.includes(child.dropoffAreaId);
                }
                return !!eligibleStaffByAreaDir
                  .get(`${child.dropoffAreaId}|dropoff`)
                  ?.has(staffId);
              }}
              tripMarks={tripMarksMap.get(child.scheduleEntryId)?.dropoff ?? []}
              /* Phase 53 (rev): 自動コピーは児童により逆効果なのでボタン化。
                 迎担当が入っていて送担当が空の時だけ「迎からコピー」ボタンを表示。
                 押すと送の退勤時刻ガード（Phase 47 ②）を通る職員だけコピーされる。 */
              copyFromPickup={
                child.pickupStaffIds.length > 0 && child.dropoffStaffIds.length === 0
                  ? () => {
                      const eligible = dropoffEligibleFor(child.dropoffTime);
                      const copied = child.pickupStaffIds.filter((id) =>
                        eligible.some((s) => s.id === id),
                      );
                      if (copied.length > 0) {
                        onStaffChange(child.scheduleEntryId, 'dropoff', copied);
                      }
                    }
                  : undefined
              }
            />
          )}
        </td>
      ),
    },
  };

  /* 列ドラッグ完了: fromIdx を toIdx へ移動した新しい順序を親に通知 */
  const handleColumnDrop = (fromIdx: number, toIdx: number) => {
    if (!onColumnReorder) return;
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    const next = [...effectiveOrder];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onColumnReorder(next);
  };

  return (
    <div
      className="overflow-x-auto"
      style={{
        borderRadius: '10px',
        border: '1px solid var(--rule)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        background: 'var(--white)',
      }}
    >
      <table className="w-full border-collapse" style={{ fontSize: '0.82rem' }}>
        <thead>
          <tr>
            {/* 児童名は常時先頭固定。ドラッグ対象外。
                Phase 47 (⑥): 横スクロール時に左端に張り付くよう position:sticky を適用。
                ヘッダーセルなので z-index は他列ヘッダー (z=2 相当) より高くする必要あり。 */}
            <th
              className="text-left"
              style={{
                ...headerBase,
                minWidth: '140px',
                position: 'sticky',
                left: 0,
                zIndex: 3,
              }}
            >
              児童名
            </th>
            {effectiveOrder.map((key, idx) => {
              const m = colMeta[key];
              const draggable = !!onColumnReorder && !disabled;
              const isDragging = dragCol === idx;
              const isDropTarget = dragOverCol === idx && dragCol !== idx;
              return (
                <th
                  key={key}
                  className="text-center"
                  style={{
                    ...headerBase,
                    minWidth: m.minWidth,
                    /* Phase 28 fix: アクセント色だと ink 背景で読みにくい行があったため、
                       ヘッダー文字は白に統一。方向の区別はラベル先頭のドットで行う */
                    color: '#fff',
                    cursor: draggable ? 'grab' : 'default',
                    opacity: isDragging ? 0.4 : 1,
                    /* Phase 28: ドロップ先にわかりやすいインジケータ線を出す */
                    outline: isDropTarget ? `2px solid ${m.accent}` : 'none',
                    outlineOffset: isDropTarget ? '-2px' : '0',
                  }}
                  draggable={draggable}
                  onDragStart={(e) => {
                    if (!draggable) return;
                    setDragCol(idx);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!draggable || dragCol === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverCol !== idx) setDragOverCol(idx);
                  }}
                  onDragLeave={() => {
                    if (dragOverCol === idx) setDragOverCol(null);
                  }}
                  onDrop={(e) => {
                    if (!draggable || dragCol === null) return;
                    e.preventDefault();
                    handleColumnDrop(dragCol, idx);
                    setDragCol(null);
                    setDragOverCol(null);
                  }}
                  onDragEnd={() => {
                    setDragCol(null);
                    setDragOverCol(null);
                  }}
                  title={draggable ? 'ドラッグで列を並び替え' : undefined}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {draggable && (
                      <span
                        aria-hidden
                        style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8em', cursor: 'grab' }}
                      >
                        ⋮⋮
                      </span>
                    )}
                    {m.header}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {children.map((child, rowIdx) => {
            const isExpanded = expandedId === child.scheduleEntryId;
            const hasAnyLocation =
              !!(child.pickupLocation || child.dropoffLocation ||
                 child.pickupAreaLabel || child.dropoffAreaLabel);
            /* Phase 47 (⑦): 行ごとの色分け（ゼブラ）。未割当行は赤系優先。
               Phase 47 (⑥): 児童名セルが sticky なので、行と同じ不透明色を持たせて
               下層列が透けないようにする必要がある。
               未割当ハイライトには --red-pale-solid を使う（--red-pale は α=0.06 で透ける）。 */
            const rowBg = child.isUnassigned
              ? 'var(--red-pale-solid)'
              : rowIdx % 2 === 0
                ? 'var(--white)'
                : 'var(--bg)';
            return (
              <React.Fragment key={child.scheduleEntryId}>
                {/* Phase 47: 行 hover で行全体をアクセント色にハイライト。
                    インライン background（zebra/未割当赤）と sticky 児童名セルを
                    一括で上書きするため、group-hover:!bg-... を全 td に当てる方式。 */}
                <tr className="group transition-colors" style={{ background: rowBg }}>
                  {/* 児童名（クリックで詳細展開）。並び替え対象外で常に先頭
                      Phase 28 fix: 未割当バッジをフル幅下に独立配置して改行・切れを防ぐ
                      Phase 47 (⑤): 児童名を太字 + サイズ大きく（1.05rem, 700）
                      Phase 47 (⑥): position:sticky で横スクロール時に左端固定 */}
                  <td
                    className="transport-day-sticky-child px-2 py-2 align-top"
                    data-row-bg={
                      child.isUnassigned ? 'red-pale' : rowIdx % 2 === 0 ? 'white' : 'bg'
                    }
                    style={{
                      borderBottom: isExpanded ? 'none' : '1px solid var(--rule)',
                      borderRight: cellBorderRight,
                      color: child.isUnassigned ? 'var(--red)' : 'var(--ink)',
                      position: 'sticky',
                      left: 0,
                      zIndex: 5,
                    }}
                  >
                    <div className="flex flex-col items-start gap-1">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : child.scheduleEntryId)}
                        className="inline-flex items-center gap-1.5 py-1 rounded transition-colors hover:bg-[var(--accent-pale)] text-left"
                        style={{ color: 'inherit' }}
                        aria-expanded={isExpanded}
                        title={hasAnyLocation ? '場所を確認（地図が開けます）' : '場所の詳細を開く'}
                      >
                        <span
                          className="inline-block transition-transform text-xs shrink-0"
                          style={{
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            color: 'var(--ink-3)',
                          }}
                          aria-hidden
                        >
                          ▶
                        </span>
                        <span
                          className="break-words"
                          style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.25 }}
                        >
                          {child.name}
                        </span>
                      </button>
                      {child.isUnassigned && (
                        <span
                          className="text-xs px-1.5 py-0.5 font-bold rounded whitespace-nowrap"
                          style={{ background: 'var(--red)', color: '#fff', fontSize: '0.65rem' }}
                        >
                          未割当
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Phase 28: 並び替え可能な 6 列を effectiveOrder の順に描画 */}
                  {effectiveOrder.map((key) => (
                    <React.Fragment key={key}>
                      {colMeta[key].renderCell(child, isExpanded)}
                    </React.Fragment>
                  ))}
                </tr>

                {/* 展開: 送迎場所リスト */}
                {isExpanded && (
                  <tr style={{ background: 'var(--bg)' }}>
                    <td
                      colSpan={colSpan}
                      className="px-4 py-3"
                      style={{ borderBottom: '1px solid var(--rule)' }}
                    >
                      <LocationDetails child={child} onAddCustomArea={onAddCustomArea} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 時刻のみのセル（Phase 26.1: HH:MM 表示、秒カット）
 */
function TimeCell({
  time,
  timeColor,
  isExpanded,
}: {
  time: string | null;
  timeColor: string;
  isExpanded: boolean;
}) {
  return (
    <td
      className="px-1 py-2 text-center align-middle font-semibold group-hover:!bg-[var(--accent-pale)] transition-colors"
      style={{
        borderBottom: isExpanded ? 'none' : '1px solid var(--rule)',
        borderRight: '1px solid var(--rule)',
        color: timeColor,
        fontSize: '0.95rem',
        letterSpacing: '0.02em',
      }}
    >
      {formatHourMinute(time)}
    </td>
  );
}

/**
 * 場所セル（Phase 27 redesigned）
 * - 単行レイアウトで全行の高さを統一
 * - エリア名自体がクリッカブル（Google Maps）
 * - 住所は title (tooltip) で確認できる
 */
function LocationCellInline({
  areaLabel,
  location,
  accentColor,
  isExpanded,
}: {
  areaLabel: string | null;
  location: string | null;
  accentColor: string;
  isExpanded: boolean;
}) {
  const { emoji, name } = splitAreaLabel(areaLabel);
  const hasAny = !!(emoji || name || location);
  const query = location ?? areaLabel ?? '';
  const clickable = !!query;
  const tooltip = location ? `${name ?? ''} — ${location}（クリックで Google Maps）`.trim() : name ?? '';

  return (
    <td
      className="px-1.5 py-2 align-middle group-hover:!bg-[var(--accent-pale)] transition-colors"
      style={{
        borderBottom: isExpanded ? 'none' : '1px solid var(--rule)',
        borderRight: '1px solid var(--rule)',
      }}
    >
      {!hasAny ? (
        <span className="text-xs" style={{ color: 'var(--ink-3)' }}>—</span>
      ) : (
        <button
          type="button"
          onClick={() => clickable && openInGoogleMaps(query)}
          disabled={!clickable}
          className="inline-flex items-center gap-2 min-w-0 max-w-full rounded-md text-left transition-colors"
          style={{
            padding: '4px 8px',
            background: clickable ? 'transparent' : 'transparent',
            cursor: clickable ? 'pointer' : 'default',
          }}
          onMouseEnter={(e) => {
            if (clickable) e.currentTarget.style.background = 'var(--bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          title={tooltip}
        >
          {emoji && (
            <span
              className="shrink-0"
              style={{ fontSize: '1rem', lineHeight: 1 }}
              aria-hidden
            >
              {emoji}
            </span>
          )}
          {name && (
            <span
              className="font-semibold truncate"
              style={{ color: accentColor, fontSize: '0.75rem' }}
            >
              {name}
            </span>
          )}
        </button>
      )}
    </td>
  );
}

/**
 * 保護者送迎バッジ（Phase 26 2-4-c）
 * method = 'self' の場合に担当ドロップダウン代わりに表示。赤エラー扱いしない。
 */
function SelfTransportBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium"
      style={{
        background: 'var(--bg)',
        color: 'var(--ink-3)',
        border: '1px dashed var(--rule)',
      }}
      title="保護者による送迎のため、担当職員の割り当ては不要です"
    >
      <span aria-hidden>👪</span>
      <span>保護者送迎</span>
    </span>
  );
}

/**
 * 児童の迎/送場所を並べて表示するパネル（Phase 17）
 * 各場所カードをクリック → Google Maps で開く
 */
function LocationDetails({
  child,
  onAddCustomArea,
}: {
  child: TransportChild;
  onAddCustomArea?: TransportDayViewProps['onAddCustomArea'];
}) {
  const pickupEmpty = !child.pickupLocation && !child.pickupAreaLabel;
  const dropoffEmpty = !child.dropoffLocation && !child.dropoffAreaLabel;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {pickupEmpty ? (
        <EmptyLocationCard
          label="迎"
          direction="pickup"
          time={child.pickupTime}
          color="var(--accent)"
          bg="var(--accent-pale)"
          childId={child.childId}
          childName={child.name}
          onAddCustomArea={onAddCustomArea}
        />
      ) : (
        <LocationCard
          label="迎"
          time={child.pickupTime}
          area={child.pickupAreaLabel}
          address={child.pickupLocation}
          color="var(--accent)"
          bg="var(--accent-pale)"
        />
      )}
      {dropoffEmpty ? (
        <EmptyLocationCard
          label="送"
          direction="dropoff"
          time={child.dropoffTime}
          color="var(--green)"
          bg="var(--green-pale)"
          childId={child.childId}
          childName={child.name}
          onAddCustomArea={onAddCustomArea}
        />
      ) : (
        <LocationCard
          label="送"
          time={child.dropoffTime}
          area={child.dropoffAreaLabel}
          address={child.dropoffLocation}
          color="var(--green)"
          bg="var(--green-pale)"
        />
      )}
    </div>
  );
}

/**
 * Phase 29+: 場所未登録の方向カード。
 * 権限があれば「＋ この児童の {迎|送} エリアを登録」ボタン → インラインフォーム。
 * 保存すると children.custom_{pickup|dropoff}_areas に追記 + 該当 mark label を選択状態に。
 * その児童の次回以降の送迎にも自動反映される（一度設定すれば常用される ④ の登録フロー）。
 */
function EmptyLocationCard({
  label,
  direction,
  time,
  color,
  bg,
  childId,
  childName,
  onAddCustomArea,
}: {
  label: string;
  direction: 'pickup' | 'dropoff';
  time: string | null;
  color: string;
  bg: string;
  childId: string;
  childName: string;
  onAddCustomArea?: TransportDayViewProps['onAddCustomArea'];
}) {
  const [editing, setEditing] = useState(false);
  const [emoji, setEmoji] = useState(direction === 'pickup' ? '🏠' : '🏠');
  const [name, setName] = useState('');
  const [timeStr, setTimeStr] = useState(formatHourMinute(time) !== '-' ? formatHourMinute(time) : '');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) {
      setError('エリア名は必須です');
      return;
    }
    if (!onAddCustomArea) return;
    setBusy(true);
    setError('');
    try {
      await onAddCustomArea(childId, direction, {
        emoji: emoji.trim() || '📍',
        name: name.trim(),
        time: timeStr.trim(),
        address: address.trim(),
      });
      setEditing(false);
      setName('');
      setAddress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="p-3 rounded-lg flex flex-col gap-1.5"
      style={{ background: bg, border: `1px solid ${color}33` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold" style={{ color }}>{label} 🚗</span>
        <span className="text-sm font-medium" style={{ color }}>{formatHourMinute(time)}</span>
        <span className="text-xs" style={{ color: 'var(--ink-3)' }}>場所未登録</span>
      </div>

      {!editing && onAddCustomArea && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1 self-start inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md transition-colors hover:opacity-85"
          style={{ color: '#fff', background: color }}
        >
          ＋ {childName} の {direction === 'pickup' ? '迎' : '送'} エリアを登録
        </button>
      )}

      {!editing && !onAddCustomArea && (
        <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
          児童管理から送迎エリアを設定してください
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-1.5 mt-1" style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 6, padding: 8 }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={2}
              aria-label="絵文字"
              style={{ width: '2.5rem', textAlign: 'center', padding: '4px', fontSize: '0.9rem', border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--bg)' }}
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="エリア名（例: おばあちゃん家）"
              aria-label="エリア名"
              style={{ flex: 1, minWidth: '7rem', padding: '4px 8px', fontSize: '0.8rem', border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--bg)' }}
            />
            <input
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              step={600}
              aria-label="基準時刻"
              style={{ width: '6rem', padding: '4px 6px', fontSize: '0.8rem', border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--bg)' }}
            />
          </div>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="住所（任意）"
            aria-label="住所"
            style={{ padding: '4px 8px', fontSize: '0.8rem', border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--bg)' }}
          />
          {error && (
            <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors hover:opacity-85"
              style={{ color: '#fff', background: color, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? '保存中...' : '登録'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setError(''); }}
              disabled={busy}
              className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors hover:bg-[var(--bg)]"
              style={{ color: 'var(--ink-3)', border: '1px solid var(--rule)', background: 'var(--white)' }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 1つの送迎場所カード。area と address のどちらもあれば両方表示し、
 * address があれば Maps ボタン、なければ area 名で検索。
 */
function LocationCard({
  label, time, area, address, color, bg,
}: {
  label: string;
  time: string | null;
  area: string | null;
  address: string | null;
  color: string;
  bg: string;
}) {
  const hasAny = !!(area || address);
  /* Maps 検索クエリ: address 優先、なければ area ラベル文字列部分 */
  const mapQuery = address ?? area ?? '';
  return (
    <div
      className="p-3 rounded-lg flex flex-col gap-1.5"
      style={{ background: bg, border: `1px solid ${color}33` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold" style={{ color }}>{label} 🚗</span>
        <span className="text-sm font-medium" style={{ color }}>
          {time || '-'}
        </span>
        {area && (
          <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
            {area}
          </span>
        )}
      </div>
      {address && (
        <div className="text-xs" style={{ color: 'var(--ink-2)' }}>
          📍 {address}
        </div>
      )}
      {hasAny && (
        <button
          type="button"
          onClick={() => openInGoogleMaps(mapQuery)}
          className="mt-1 self-start inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md transition-colors hover:opacity-85"
          style={{
            color: '#fff',
            background: color,
          }}
          aria-label={`${label}の場所を Google Maps で開く`}
        >
          🗺 地図で開く
        </button>
      )}
      {!hasAny && (
        <div className="text-xs" style={{ color: 'var(--ink-3)' }}>場所未登録</div>
      )}
    </div>
  );
}

/* 担当者選択ドロップダウン（最大2名） */
function StaffSelect({
  staffIds,
  availableStaff,
  onChange,
  disabled,
  dayLocked = false,
  direction,
  rowAreaEmoji,
  rowAreaId,
  isAreaCovered,
  tripMarks,
  copyFromPickup,
}: {
  staffIds: string[];
  availableStaff: TransportStaff[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  /** Phase 58: 「保存済み」= true。false なら自動割り当て状態 → 背景をグレーで「仮」表示 */
  dayLocked?: boolean;
  /** Phase 27: 迎担当=pickup のマークのみ表示、送担当=dropoff のマークのみ表示 */
  direction: 'pickup' | 'dropoff';
  /** Phase 60: この便の AreaLabel.id。対応外職員判定に使う。null ならチェックしない */
  rowAreaId?: string | null;
  /** Phase 60: 職員がこのエリアに対応できるかを判定するクロージャ。
      tenant area / child-specific area の 2 段階判定を親側で吸収する。 */
  isAreaCovered?: (staffId: string, staffAreaIds: string[]) => boolean;
  /** Phase 47 (①): この行（=この便）のエリア絵文字。
      旧実装は職員の 1 日全エリアを集計表示していたため、
      別便でも同じ職員担当だと "🐻✏" のように合体表示されてしまっていた。
      行ごとに「この便のエリア」だけを出すことで、別便であることが視覚的にわかる。 */
  rowAreaEmoji: string | null;
  /** Phase 47 (①再修正): この行と同じ便（=同じ職員・同方向・30 分以内）の全マーク集合。
      これにより 16:00 に 🌳 と 🏭 を同じ職員が回るケースは両行とも 🌳🏭 と表示される。 */
  tripMarks?: string[];
  /** Phase 53 (rev): 「迎からコピー」ボタン押下時に呼ばれる。
      送担当が空かつ迎担当があるときだけ親から渡される想定。 */
  copyFromPickup?: () => void;
}) {
  const handleChange = (index: number, newId: string) => {
    const updated = [...staffIds];
    if (newId === '') {
      updated.splice(index, 1);
    } else {
      updated[index] = newId;
    }
    onChange(updated);
    /* Phase 60: 選択が決まれば展開状態は解除（閉じた「＋」表示には戻らないが、他セルを触って再オープンできる） */
    setActiveSlotIdx(null);
  };

  /* Phase 60: 空スロットを「＋」ボタンに折りたたむ挙動。
     クリックで当該スロットを展開（プルダウン表示）、他の個所クリックで戻る。 */
  const [activeSlotIdx, setActiveSlotIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeSlotIdx === null) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        /* 外側クリック: 展開状態を解除し、未確定の空スロットを掃除する（trailing 空きを残さない） */
        setActiveSlotIdx(null);
        const pruned = staffIds.filter((id) => id !== '');
        if (pruned.length !== staffIds.length) onChange(pruned);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [activeSlotIdx, staffIds, onChange]);

  const handleAdd = () => {
    if (staffIds.length >= 2) return;
    const next = [...staffIds, ''];
    onChange(next);
    setActiveSlotIdx(next.length - 1);
  };

  /* Phase 28: 横並びコンパクト表示（Excel 準拠）
     絵文字マーク + 氏名ドロップダウンを inline-flex で横に並べ、
     2 人目追加ボタンも横にインラインで配置する。行数を 1 行に抑えるのが目的。
     マークは担当者全員分のユニオンを先頭に 1 回だけ表示（Excel の "🚂🍇 金田・加藤" 準拠）
     Phase 28 F案: staff.display_name（3 文字上限）で表示するため select 幅を大幅縮小。
     フルネームは option 側で残すので同姓の区別は候補選択時に可能。 */
  /* Phase 44: 旧 60px ではネイティブ select の右端矢印に削られて 3 文字が「あ...」に省略されていた。
     80px + 右パディング縮小で 3 文字（「あやせ」「ヨハン」「中條さ」など）が見切れず表示される。 */
  const SELECT_WIDTH = 80;

  /* Phase 47 (①再修正): tripMarks（同便の全エリア集合）を優先。
     未指定の場合は行のエリアマーク 1 個にフォールバック。 */
  const rowMarks: string[] =
    tripMarks && tripMarks.length > 0
      ? tripMarks
      : rowAreaEmoji
        ? [rowAreaEmoji]
        : [];

  /* Phase 28 F案: select 幅を 60px まで縮めた分、マーク slot を 4.5em まで拡張。
     4〜5 マークまで欠けずに表示でき、それ以上は先頭 4 個だけ見せて tooltip で全件確認 */
  const MARK_SLOT_WIDTH = '4.5em';
  return (
    /* Phase 28: flex-wrap を禁止。担当セルは常に 1 行で、幅が足りなければテーブル側で横スクロール */
    <div className="flex flex-nowrap items-center gap-1.5">
      <span
        className="shrink-0 text-left"
        style={{
          display: 'inline-block',
          width: MARK_SLOT_WIDTH,
          lineHeight: 1,
          fontSize: '1rem',
          letterSpacing: '-0.02em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          opacity: rowMarks.length > 0 ? 0.9 : 0,
        }}
        title={rowMarks.length > 0 ? `この便のエリア: ${rowMarks.join(' ')}` : undefined}
        aria-label={rowMarks.length > 0 ? `担当エリア ${rowMarks.join(' ')}` : undefined}
        aria-hidden={rowMarks.length === 0}
      >
        {rowMarks.slice(0, 4).join('')}
      </span>
      {/* Phase 60: 閲覧のみ（viewer or 確定済み）はプルダウンを出さず、担当者名 or "—" をプレーン表示。
          編集者向けの赤枠「未選択」は見てもアクションできないので隠す。 */}
      {disabled ? (
        (() => {
          const names = staffIds
            .filter((id) => id !== '')
            .map((id) => {
              const s = availableStaff.find((x) => x.id === id);
              return s ? staffDisplayName(s) || s.name : '（候補外）';
            });
          return (
            <span
              className="shrink-0"
              style={{
                fontSize: '0.78rem',
                color: names.length > 0 ? 'var(--ink)' : 'var(--ink-3)',
                padding: '4px 2px',
              }}
            >
              {names.length > 0 ? names.join('・') : '—'}
            </span>
          );
        })()
      ) : (
      <div ref={containerRef} className="inline-flex items-center gap-1.5 flex-nowrap">
      {(staffIds.length === 0 ? [''] : staffIds).map((id, i) => {
        /* Phase 60: 空スロット（id === ''）はデフォルトで「＋」ボタンに折りたたむ。
           active にしたスロットだけ展開して未選択プルダウンを表示する。 */
        if (id === '' && activeSlotIdx !== i) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => setActiveSlotIdx(i)}
              className="rounded-md transition-colors shrink-0"
              style={{
                padding: '4px 10px',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: 'var(--accent)',
                border: '1px dashed var(--accent)',
                background: 'transparent',
                whiteSpace: 'nowrap',
                minWidth: '36px',
              }}
              title={i === 0 ? '担当を選択' : 'もう 1 名追加'}
              aria-label={i === 0 ? '担当を選択' : 'もう 1 名追加'}
            >
              ＋
            </button>
          );
        }
        const isMissing = id !== '' && !availableStaff.some((s) => s.id === id);
        /* Phase 28 fix: 他スロットで既に選ばれている職員を候補から除外し、
           同一送迎で同じ職員が 2 回選ばれるバグを防ぐ。自スロットの値は残す */
        const takenByOthers = new Set(
          staffIds.filter((sid, idx) => idx !== i && sid !== ''),
        );
        /* Phase 59: スロット別フィルタ。
           左（i=0, 主担当/運転手枠）= is_driver=true のみ。
           右（i=1, 副担当枠）= is_driver=true OR is_attendant=true（運転手or付き添い）。
           どちらのフラグも false の職員は候補から完全に消える。 */
        const candidateStaff = availableStaff.filter((s) => {
          if (i === 0) return s.isDriver;
          return s.isDriver || s.isAttendant;
        });
        /* Phase 60: 選択中の職員がエリア対応外かを判定。閉じた select の左に ⚠ アイコンを出す。
           select 内テキスト（80px）を圧迫しないよう外出し表示。 */
        const selectedStaff = id !== '' ? availableStaff.find((s) => s.id === id) : null;
        const selectedAreas = selectedStaff
          ? (direction === 'pickup' ? selectedStaff.pickupAreaIds : selectedStaff.dropoffAreaIds)
          : [];
        const selectedOutOfArea = !!rowAreaId && !!selectedStaff
          ? (isAreaCovered
              ? !isAreaCovered(selectedStaff.id, selectedAreas)
              : !selectedAreas.includes(rowAreaId))
          : false;
        return (
          <div key={i} className="inline-flex items-center gap-1">
            {selectedOutOfArea && (
              <span
                aria-label="対応エリア外"
                title="この職員はこのエリアに対応設定がありません"
                style={{
                  color: 'var(--red)',
                  fontSize: '0.85rem',
                  lineHeight: 1,
                }}
              >
                ⚠
              </span>
            )}
            <select
              value={id}
              onChange={(e) => handleChange(i, e.target.value)}
              disabled={disabled}
              className="outline-none disabled:opacity-60"
              style={{
                width: SELECT_WIDTH,
                /* Phase 44: 右パディングを 6→2 に削って文字領域を確保（矢印は変えられないが余白は減らせる） */
                padding: '4px 2px 4px 6px',
                fontSize: '0.78rem',
                border: `1px solid ${isMissing ? 'var(--red)' : id ? 'var(--rule)' : 'var(--red)'}`,
                borderRadius: '6px',
                color: id ? (isMissing ? 'var(--red)' : 'var(--ink)') : 'var(--red)',
                /* Phase 58: 未保存（自動割り当て状態）なら背景を薄グレーに。
                   保存すると白に戻り、ユーザーが「手を入れて確定した」ことが一目で分かる。 */
                background: id
                  ? isMissing
                    ? 'var(--red-pale)'
                    : dayLocked
                    ? 'var(--white)'
                    : 'rgba(0,0,0,0.04)'
                  : 'var(--red-pale)',
                /* Phase 28 F案: 表示名が SELECT_WIDTH を超える場合は省略（native select の text-overflow） */
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
              title={(() => {
                /* Phase 28 F案: 選択中の職員のフルネームを tooltip に出す（表示名 3 文字だけでは
                   同姓判別できないことがあるため）。さらに当日の担当エリア情報も併記 */
                if (isMissing) return 'この職員は当日の送迎候補外です（勤務時間を確認してください）';
                const selected = availableStaff.find((s) => s.id === id);
                const parts: string[] = [];
                if (selected) parts.push(selected.name);
                if (rowMarks.length > 0) parts.push(`この便のエリア: ${rowMarks.join(' ')}`);
                return parts.length > 0 ? parts.join('\n') : undefined;
              })()}
            >
              <option value="">{i === 0 && candidateStaff.length === 0 ? '運転手なし' : '未選択'}</option>
              {isMissing && <option value={id}>（候補外）</option>}
              {candidateStaff
                .filter((s) => !takenByOthers.has(s.id))
                .map((s) => {
                  /* Phase 28 F案: セル幅 60px に収めるため option 表示は短縮名のみ。
                     同姓判別はフルネームを title（hover）で確認する運用 */
                  const short = staffDisplayName(s);
                  /* Phase 60: エリア対応可否。対応外でも候補から外さず「⚠対応外」マーカーで警告表示。
                     急遽ヘルプに入るケースを潰さないため選択は許可する（CLAUDE.md §8 の運用思想）。
                     tenant area / child-specific area の 2 段階判定は isAreaCovered クロージャが吸収。 */
                  const areas =
                    direction === 'pickup' ? s.pickupAreaIds : s.dropoffAreaIds;
                  const outOfArea = !!rowAreaId
                    ? isAreaCovered
                      ? !isAreaCovered(s.id, areas)
                      : !areas.includes(rowAreaId)
                    : false;
                  return (
                    <option
                      key={s.id}
                      value={s.id}
                      title={outOfArea ? `${s.name}（対応エリア外）` : s.name}
                      /* Phase 60: 対応外は option を赤字に（⚠ プレフィックスは幅を食うため廃止）。
                         閉じた select では別途アイコンで警告表示する。 */
                      style={outOfArea ? { color: 'var(--red)' } : undefined}
                    >
                      {short || s.name}
                    </option>
                  );
                })}
            </select>
          </div>
        );
      })}
      {/* Phase 60: 1 名選択済み・2 人目未追加 のとき「＋」ボタンで空スロットを生やす */}
      {staffIds.length === 1 && staffIds[0] !== '' && !disabled && (
        <button
          type="button"
          onClick={handleAdd}
          className="rounded-md transition-colors shrink-0"
          style={{
            padding: '4px 10px',
            fontSize: '0.78rem',
            fontWeight: 600,
            color: 'var(--accent)',
            border: '1px dashed var(--accent)',
            background: 'transparent',
            whiteSpace: 'nowrap',
            minWidth: '36px',
          }}
          title="もう 1 名追加"
          aria-label="担当をもう 1 名追加"
        >
          ＋
        </button>
      )}
      </div>
      )}
      {/* Phase 53 (rev): 送担当で迎担当が入っていて送が空なら「迎からコピー」の絵文字ボタン。
          迎に 2 名いたら 2 名まとめてコピー（退勤時刻ガードを通る職員のみ）。
          自動コピーは児童ごとに正解が違うので手動ボタン方式にした。 */}
      {direction === 'dropoff' && copyFromPickup && !disabled && (
        <button
          onClick={copyFromPickup}
          className="rounded-md transition-colors shrink-0"
          style={{
            padding: '2px 6px',
            fontSize: '0.95rem',
            lineHeight: 1,
            border: '1px dashed var(--accent)',
            background: 'transparent',
            whiteSpace: 'nowrap',
          }}
          title="迎担当をそのまま送担当にコピー（2名いればまとめてコピー。送の退勤時刻ガードを通る職員のみ）"
          aria-label="迎担当から送担当へコピー"
        >
          📥
        </button>
      )}
    </div>
  );
}
