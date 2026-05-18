'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { Facility, TargetType, Position } from '@/lib/types';

/**
 * 配信ターゲット選択 UI（migration 115 で department 配信を廃止後の版）。
 * 施設範囲（all / facility）+ 役職フィルタ（任意）の 2 軸で配信先を絞る。
 */

interface Props {
    tenantId: string | null;
    targetType: TargetType;
    targetFacilityIds: string[];
    targetPositionIds: string[];
    onChange: (next: {
        target_type: TargetType;
        target_facility_ids: string[];
        target_position_ids: string[];
    }) => void;
    label?: string;
}

export function AttributeTargetSelector({
    tenantId,
    targetType,
    targetFacilityIds,
    targetPositionIds,
    onChange,
    label = '配信ターゲット設定',
}: Props) {
    const [facilities, setFacilities] = useState<Facility[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const supabase = createClient();

    useEffect(() => {
        if (!tenantId) return;
        Promise.all([
            supabase.from('facilities').select('id, name').eq('tenant_id', tenantId).order('display_order', { ascending: true }).order('created_at', { ascending: true }),
            supabase.from('positions').select('id, name').eq('tenant_id', tenantId).order('display_order'),
        ]).then(([facRes, posRes]) => {
            setFacilities((facRes.data as Facility[]) || []);
            setPositions((posRes.data as Position[]) || []);
        });
    }, [tenantId, supabase]);

    function toggleItem(list: string[], id: string) {
        return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    }

    return (
        <div className="space-y-6 p-5 border-2 border-brand-blue/20 bg-white/50 backdrop-blur-sm rounded-md shadow-sm">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue text-lg">🎯</div>
                <Label className="text-base font-bold text-brand-ink">{label}</Label>
            </div>

            {/* 施設スコープ (排他的) */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-brand-gray uppercase tracking-widest">1. 施設範囲</Label>
                    <Badge variant="secondary" className="bg-white text-[10px] font-normal border border-brand-gray/10">必須</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => onChange({ target_type: 'all', target_facility_ids: [], target_position_ids: targetPositionIds })}
                        className={`flex items-center justify-center gap-2 h-12 rounded-md border-2 transition-all ${targetType === 'all'
                            ? 'border-brand-blue bg-brand-blue text-white shadow-md scale-[1.02]'
                            : 'border-brand-gray/10 bg-white text-brand-gray hover:border-brand-blue/30'
                            }`}
                    >
                        <span className="text-lg">🌍</span>
                        <span className="text-sm font-bold">全施設</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange({ target_type: 'facility', target_facility_ids: targetFacilityIds, target_position_ids: targetPositionIds })}
                        className={`flex items-center justify-center gap-2 h-12 rounded-md border-2 transition-all ${targetType === 'facility'
                            ? 'border-brand-blue bg-brand-blue text-white shadow-md scale-[1.02]'
                            : 'border-brand-gray/10 bg-white text-brand-gray hover:border-brand-blue/30'
                            }`}
                    >
                        <span className="text-lg">🏢</span>
                        <span className="text-sm font-bold">施設指定</span>
                    </button>
                </div>

                {targetType === 'facility' && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-brand-blue/5 rounded-md border border-brand-blue/10">
                        {facilities.map((f) => (
                            <label key={f.id} className="flex items-center gap-3 p-2 rounded-md bg-white/80 hover:bg-white cursor-pointer transition-colors group">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-brand-gray/30 text-brand-blue focus:ring-brand-blue accent-brand-blue"
                                    checked={targetFacilityIds.includes(f.id)}
                                    onChange={() => onChange({
                                        target_type: 'facility',
                                        target_facility_ids: toggleItem(targetFacilityIds, f.id),
                                        target_position_ids: targetPositionIds,
                                    })}
                                />
                                <span className="text-xs font-medium text-brand-ink group-hover:text-brand-blue transition-colors">{f.name}</span>
                            </label>
                        ))}
                        {targetFacilityIds.length === 0 && (
                            <p className="col-span-full text-[10px] text-brand-red font-bold animate-pulse">※ 施設を1つ以上選択してください</p>
                        )}
                    </div>
                )}
            </div>

            {/* 役職フィルター (AND条件) */}
            <div className="space-y-3 pt-4 border-t border-brand-gray/5">
                <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-brand-gray uppercase tracking-widest">2. 役職フィルター (任意)</Label>
                    <p className="text-[9px] text-brand-gray-light">未選択の場合：全役職が対象</p>
                </div>
                <div className="flex flex-wrap gap-2 p-3 bg-brand-ink/5 rounded-md border border-brand-ink/10">
                    {positions.map((p) => (
                        <label key={p.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all cursor-pointer ${targetPositionIds.includes(p.id)
                            ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                            : 'bg-white text-brand-gray border-brand-gray/10 hover:border-brand-ink/30'
                            }`}>
                            <input
                                type="checkbox"
                                className="sr-only"
                                checked={targetPositionIds.includes(p.id)}
                                onChange={() => onChange({
                                    target_type: targetType,
                                    target_facility_ids: targetFacilityIds,
                                    target_position_ids: toggleItem(targetPositionIds, p.id),
                                })}
                            />
                            <span className="text-[11px] font-bold">{p.name}</span>
                        </label>
                    ))}
                    {positions.length === 0 && <p className="text-[10px] text-brand-gray-light italic">役職が登録されていません</p>}
                </div>
            </div>

            <p className="text-[10px] text-brand-gray-light leading-relaxed">
                ※ 施設と役職のすべてに該当する社員へ配信されます。<br />
                （役職を未選択にした場合は、その項目による制限は行われません）
            </p>
        </div>
    );
}

interface BadgeProps {
    targetType: TargetType;
    targetFacilityIds: string[];
    targetPositionIds: string[];
    facilities: Facility[];
    positions: Position[];
}

export function TargetAttributeBadges({
    targetType,
    targetFacilityIds,
    targetPositionIds,
    facilities,
    positions,
}: BadgeProps) {
    const facMap = new Map(facilities.map((f) => [f.id, f.name]));
    const posMap = new Map(positions.map((p) => [p.id, p.name]));

    const facNames = targetType === 'all' ? ['全施設'] : (targetFacilityIds || []).map((id) => facMap.get(id)).filter(Boolean);
    const posNames = (targetPositionIds || []).map((id) => posMap.get(id)).filter(Boolean);

    return (
        <div className="flex flex-wrap gap-1 items-center">
            <Badge variant="outline" className="text-[10px] font-bold border-brand-blue/30 text-brand-blue bg-brand-blue/5">
                施設: {facNames.length > 0 ? facNames.join(', ') : '未選択'}
            </Badge>
            {posNames.length > 0 && (
                <Badge variant="outline" className="text-[10px] font-bold border-brand-ink/30 text-brand-ink bg-brand-ink/5">
                    役職: {posNames.join(', ')}
                </Badge>
            )}
        </div>
    );
}
