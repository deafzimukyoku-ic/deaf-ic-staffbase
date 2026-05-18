'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { Facility, TargetType } from '@/lib/types';

interface Props {
  tenantId: string | null;
  targetType: TargetType;
  targetFacilityIds: string[];
  onChange: (next: { target_type: TargetType; target_facility_ids: string[] }) => void;
  label?: string;
}

export function FacilityScopeSelector({ tenantId, targetType, targetFacilityIds, onChange, label = '配信対象' }: Props) {
  const [facilities, setFacilities] = useState<Facility[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    const supabase = createClient();
    supabase.from('facilities').select('id, name').eq('tenant_id', tenantId).order('display_order', { ascending: true }).order('created_at', { ascending: true }).then(({ data }) => {
      setFacilities((data as Facility[]) || []);
    });
  }, [tenantId]);

  function toggleFacility(id: string) {
    const next = targetFacilityIds.includes(id)
      ? targetFacilityIds.filter((f) => f !== id)
      : [...targetFacilityIds, id];
    onChange({ target_type: 'facility', target_facility_ids: next });
  }

  return (
    <div className="rounded-lg border-2 border-brand-blue/40 bg-brand-blue/[0.04] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">📣</span>
        <Label className="text-sm font-bold text-brand-ink">{label}</Label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label
          className={`flex items-center justify-center gap-2 cursor-pointer rounded-md border-2 py-2.5 px-3 text-sm font-medium transition-all ${
            targetType === 'all'
              ? 'border-brand-blue bg-brand-blue text-white shadow-sm'
              : 'border-brand-gray/20 bg-white text-brand-gray hover:border-brand-blue/40'
          }`}
        >
          <input
            type="radio"
            className="sr-only"
            checked={targetType === 'all'}
            onChange={() => onChange({ target_type: 'all', target_facility_ids: [] })}
          />
          <span>👥 全社員</span>
        </label>
        <label
          className={`flex items-center justify-center gap-2 cursor-pointer rounded-md border-2 py-2.5 px-3 text-sm font-medium transition-all ${
            targetType === 'facility'
              ? 'border-brand-blue bg-brand-blue text-white shadow-sm'
              : 'border-brand-gray/20 bg-white text-brand-gray hover:border-brand-blue/40'
          }`}
        >
          <input
            type="radio"
            className="sr-only"
            checked={targetType === 'facility'}
            onChange={() => onChange({ target_type: 'facility', target_facility_ids: targetFacilityIds })}
          />
          <span>🏢 施設を選択</span>
        </label>
      </div>

      {targetType === 'facility' && (
        <div className="rounded-md border border-brand-blue/30 bg-white p-3 space-y-1.5">
          {facilities.length === 0 ? (
            <p className="text-xs text-brand-gray-light">施設が登録されていません。設定＞組織から登録してください。</p>
          ) : (
            facilities.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer py-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-blue"
                  checked={targetFacilityIds.includes(f.id)}
                  onChange={() => toggleFacility(f.id)}
                />
                <span>{f.name}</span>
              </label>
            ))
          )}
          {targetType === 'facility' && targetFacilityIds.length === 0 && (
            <p className="text-[11px] text-brand-red mt-1 font-medium">※ 少なくとも1つの施設を選択してください</p>
          )}
        </div>
      )}
      <p className="text-[11px] text-brand-gray-light">
        施設未所属の社員は「全社員」を選択した場合のみ配信されます。
      </p>
    </div>
  );
}

// 社員画面フィルタ用ヘルパー
// facility_id が NULL の社員は target_type='all' のみ閲覧可
export function applyScopeFilter<T extends { target_type: TargetType; target_facility_ids: string[] }>(
  items: T[],
  myFacilityId: string | null
): T[] {
  return items.filter((item) => {
    if (item.target_type === 'all') return true;
    if (!myFacilityId) return false;
    return item.target_facility_ids.includes(myFacilityId);
  });
}

// 一覧表示用バッジ: 「対象: 全社員」または「対象: ○○支店, △△支店」
export function TargetScopeBadge({
  targetType,
  targetFacilityIds,
  facilities,
}: {
  targetType: TargetType;
  targetFacilityIds: string[];
  facilities: Facility[];
}) {
  if (targetType === 'all') {
    return <Badge variant="outline" className="text-[10px] font-normal">対象: 全社員</Badge>;
  }
  const map = new Map(facilities.map((f) => [f.id, f.name]));
  const names = targetFacilityIds.map((id) => map.get(id) ?? '（削除済み）').filter(Boolean);
  const label = names.length > 0 ? names.join(', ') : '（未選択）';
  return (
    <Badge variant="outline" className="text-[10px] font-normal border-brand-blue/40 text-brand-blue">
      対象: {label}
    </Badge>
  );
}
