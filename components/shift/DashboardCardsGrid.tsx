'use client';

/**
 * シフト・送迎ダッシュボードのカードグリッド（admin / manager 共通）
 *
 * - 選択中事業所が shift_only_mode=true ならカードを「シフト表 / 休み希望一覧 / 職員管理」3 枚に絞る
 *   （sidebar フィルタと同じ方針 / migration 125）
 * - それ以外は server から渡された cards をそのまま描画
 *
 * server component の dashboard page は statuses を集計して渡し、ここは表示と絞り込みのみ担当。
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import { MonthStatusBadge } from '@/components/shift/MonthStatusBadge';

export type DashboardStatus = 'empty' | 'incomplete' | 'complete';
export type DashboardCardKey = 'schedule' | 'shift' | 'transport' | 'request';

export type DashboardCard = {
  href: string;
  title: string;
  desc: string;
  icon: string;
  key?: DashboardCardKey;
};

interface Props {
  cards: DashboardCard[];
  statuses: Record<DashboardCardKey, DashboardStatus>;
  scope: 'admin' | 'manager';
}

export default function DashboardCardsGrid({ cards, statuses, scope }: Props) {
  const [shiftFacilityId] = useShiftFacilityId();
  const [shiftOnlyMode, setShiftOnlyMode] = useState(false);

  useEffect(() => {
    if (!shiftFacilityId) {
      setShiftOnlyMode(false);
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from('facilities')
      .select('shift_only_mode')
      .eq('id', shiftFacilityId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setShiftOnlyMode(data?.shift_only_mode === true);
      });
    return () => {
      cancelled = true;
    };
  }, [shiftFacilityId]);

  const visibleCards = useMemo<DashboardCard[]>(() => {
    if (!shiftOnlyMode) return cards;
    /* shift_only_mode=true: シフト表 / 休み希望一覧 を残し、設定は「職員管理」カードに置換 */
    const base = scope === 'admin' ? '/admin' : '/mgr';
    const keepHrefs = new Set<string>([`${base}/shifts`, `${base}/requests`]);
    const filtered = cards.filter((c) => keepHrefs.has(c.href));
    filtered.push({
      href: `${base}/shifts/staff-settings`,
      title: '職員管理',
      desc: '事業所所属職員の管理',
      icon: '👔',
    });
    return filtered;
  }, [cards, shiftOnlyMode, scope]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {visibleCards.map((c) => {
        const status = c.key ? statuses[c.key] : null;
        return (
          <Link
            key={c.href}
            href={c.href}
            className="relative p-5 bg-white rounded-md border border-brand-gray/10 shadow-sm hover:shadow-md hover:border-brand-blue/30 transition-all group"
          >
            {status && status !== 'empty' && (
              <div className="absolute top-3 right-3">
                <MonthStatusBadge status={status} compact />
              </div>
            )}
            <div className="text-3xl mb-3">{c.icon}</div>
            <div className="text-base font-bold text-brand-ink mb-1">{c.title}</div>
            <div className="text-xs text-brand-gray leading-relaxed">{c.desc}</div>
          </Link>
        );
      })}
    </div>
  );
}
