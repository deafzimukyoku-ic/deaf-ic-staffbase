import type {
  ScheduleEntryRow,
  ChildRow,
  AreaLabel,
} from '@/lib/types';

/**
 * 送迎仕様の解決（shift-puzzle の lib/logic/resolveTransportSpec.ts 忠実移植）
 * Phase 30: マーク識別を AreaLabel.id ベース。
 *
 * schedule_entry から送迎に必要な情報（エリア・時刻・場所）を
 * 迎/送それぞれで解決する。解決順:
 *   (a) pickup_mark / dropoff_mark（id）が有効 → facility pickup_areas / dropoff_areas
 *       または児童専用 custom_pickup_areas / custom_dropoff_areas から area を解決
 *   (b) マーク未設定なら児童の pickup_area_labels / dropoff_area_labels 候補（id 配列）
 *       × entry の時刻から推論
 *   (c) entry 側の pickup_time / dropoff_time と住所フォールバック（最終手段）
 */

export type TransportSpec = {
  areaId: string | null;
  areaLabel: string | null;
  time: string | null;
  location: string | null;
};

export type ResolvedTransport = {
  pickup: TransportSpec;
  dropoff: TransportSpec;
};

function normTime(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function findAreaById(areas: AreaLabel[], id: string | null): AreaLabel | undefined {
  if (!id) return undefined;
  return areas.find((a) => a.id === id);
}

export function formatAreaLabel(a: AreaLabel | null | undefined): string | null {
  if (!a) return null;
  return `${a.emoji} ${a.name}`;
}

/**
 * facility 共通エリア + 児童専用エリアをマージ。同 id は児童専用優先。
 */
export function mergeAreas(
  tenantAreas: AreaLabel[] | null | undefined,
  customAreas: AreaLabel[] | null | undefined,
): AreaLabel[] {
  const base = Array.isArray(tenantAreas) ? tenantAreas : [];
  const custom = Array.isArray(customAreas) ? customAreas : [];
  if (custom.length === 0) return base;
  const byId = new Map<string, AreaLabel>();
  for (const a of base) byId.set(a.id, a);
  for (const c of custom) {
    const prev = byId.get(c.id);
    byId.set(c.id, {
      id: c.id,
      emoji: c.emoji,
      name: c.name,
      time: c.time ?? prev?.time,
      address: c.address ?? prev?.address,
    });
  }
  return Array.from(byId.values());
}

/**
 * 児童のマーク候補（id 配列）× 解析時刻から、最もマッチするマーク id を推論。
 * 優先度: 完全一致 → ±15分 → 候補1件のみ → null
 */
export function inferMarkFromTime(
  markCandidates: string[] | null | undefined,
  tenantAreas: AreaLabel[] | null | undefined,
  time: string | null,
): string | null {
  if (!markCandidates || markCandidates.length === 0) return null;
  const areas = Array.isArray(tenantAreas) ? tenantAreas : [];
  if (areas.length === 0) {
    return markCandidates.length === 1 ? markCandidates[0] : null;
  }
  const target = normTime(time);
  if (!target) {
    return markCandidates.length === 1 ? markCandidates[0] : null;
  }

  const resolved = markCandidates
    .map((id) => ({ id, area: findAreaById(areas, id) }))
    .filter((x): x is { id: string; area: AreaLabel } => !!x.area && !!x.area.time);

  if (resolved.length === 0) {
    return markCandidates.length === 1 ? markCandidates[0] : null;
  }

  const exact = resolved.find((r) => normTime(r.area.time!) === target);
  if (exact) return exact.id;

  const [th, tm] = target.split(':').map(Number);
  const targetMin = th * 60 + tm;
  let best: { id: string; diff: number } | null = null;
  for (const r of resolved) {
    const [h, m] = normTime(r.area.time!)!.split(':').map(Number);
    const diff = Math.abs(h * 60 + m - targetMin);
    if (diff <= 15 && (!best || diff < best.diff)) {
      best = { id: r.id, diff };
    }
  }
  if (best) return best.id;

  return markCandidates.length === 1 ? markCandidates[0] : null;
}

export function resolveEntryTransportSpec(
  entry: ScheduleEntryRow,
  params: {
    child: ChildRow | undefined;
    pickupAreas: AreaLabel[];
    dropoffAreas: AreaLabel[];
  },
): ResolvedTransport {
  const { child } = params;
  const pickupAreas = mergeAreas(params.pickupAreas, child?.custom_pickup_areas);
  const dropoffAreas = mergeAreas(params.dropoffAreas, child?.custom_dropoff_areas);

  const pickupMarkId =
    entry.pickup_mark
    ?? inferMarkFromTime(child?.pickup_area_labels, pickupAreas, entry.pickup_time);
  const dropoffMarkId =
    entry.dropoff_mark
    ?? inferMarkFromTime(child?.dropoff_area_labels, dropoffAreas, entry.dropoff_time);

  const resolveDirection = (direction: 'pickup' | 'dropoff'): TransportSpec => {
    const areas = direction === 'pickup' ? pickupAreas : dropoffAreas;
    const markId = direction === 'pickup' ? pickupMarkId : dropoffMarkId;
    const entryTime = normTime(direction === 'pickup' ? entry.pickup_time : entry.dropoff_time);
    const area = markId ? findAreaById(areas, markId) : undefined;
    const markTime = area?.time ?? null;
    const markAddr = area?.address ?? null;
    const label = formatAreaLabel(area);

    if (direction === 'pickup') {
      return {
        areaId: area?.id ?? null,
        areaLabel: label,
        time: entryTime ?? markTime,
        location: markAddr,
      };
    }
    return {
      areaId: area?.id ?? null,
      areaLabel: label,
      time: entryTime ?? markTime,
      location: markAddr ?? child?.home_address ?? null,
    };
  };

  return {
    pickup: resolveDirection('pickup'),
    dropoff: resolveDirection('dropoff'),
  };
}
