'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, addMonths, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import { ja } from 'date-fns/locale';
import { GRADE_LABELS } from '@/lib/constants';
import { ScheduleCellEditor } from '@/components/shift/ScheduleCellEditor';
import type { ChildRow, ScheduleEntryRow, Facility } from '@/lib/types';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
}

function monthKey(d: Date): string {
  return format(d, 'yyyy-MM');
}

export function ScheduleGrid({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [entries, setEntries] = useState<ScheduleEntryRow[]>([]);
  const [loading, setLoading] = useState(true);

  // 月 + 事業所フィルタ
  const [month, setMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [facilityFilter, setFacilityFilter] = useState<string>('all');

  // セル編集ダイアログ
  const [editOpen, setEditOpen] = useState(false);
  const [editChild, setEditChild] = useState<ChildRow | null>(null);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<ScheduleEntryRow | null>(null);

  const monthStart = useMemo(() => startOfMonth(month), [month]);
  const monthEnd = useMemo(() => endOfMonth(month), [month]);
  const days = useMemo(() => eachDayOfInterval({ start: monthStart, end: monthEnd }), [monthStart, monthEnd]);
  const monthStr = monthKey(month);

  const loadBasics = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: meData } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (!meData) return;
    setMe(meData as MeRow);

    const tid = meData.tenant_id;

    const { data: facData } = await supabase
      .from('facilities')
      .select('id, name, tenant_id, address, created_at')
      .eq('tenant_id', tid)
      .order('created_at');
    const allFacs = (facData as Facility[]) || [];
    const scoped = scope === 'manager' && meData.facility_id
      ? allFacs.filter((f) => f.id === meData.facility_id)
      : allFacs;
    setFacilities(scoped);

    const { data: childData } = await supabase
      .from('children')
      .select('*')
      .eq('tenant_id', tid)
      .eq('is_active', true)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    setChildren((childData as ChildRow[]) || []);
  }, [supabase, scope]);

  const loadEntries = useCallback(async () => {
    if (!me) return;
    const fromStr = format(monthStart, 'yyyy-MM-dd');
    const toStr = format(monthEnd, 'yyyy-MM-dd');
    const { data } = await supabase
      .from('schedule_entries')
      .select('*')
      .eq('tenant_id', me.tenant_id)
      .gte('date', fromStr)
      .lte('date', toStr);
    setEntries((data as ScheduleEntryRow[]) || []);
  }, [supabase, me, monthStart, monthEnd]);

  useEffect(() => {
    loadBasics().then(() => setLoading(false));
  }, [loadBasics]);

  useEffect(() => {
    if (me) loadEntries();
  }, [me, monthStr, loadEntries]);

  // 表示対象の children (facility filter 適用)
  const visibleChildren = useMemo(() => {
    if (facilityFilter === 'all') return children;
    return children.filter((c) => c.facility_id === facilityFilter);
  }, [children, facilityFilter]);

  // entry lookup: `${child_id}|${yyyy-MM-dd}` → ScheduleEntryRow
  const entryMap = useMemo(() => {
    const m = new Map<string, ScheduleEntryRow>();
    for (const e of entries) m.set(`${e.child_id}|${e.date}`, e);
    return m;
  }, [entries]);

  function openCell(child: ChildRow, dateStr: string) {
    setEditChild(child);
    setEditDate(dateStr);
    setEditEntry(entryMap.get(`${child.id}|${dateStr}`) ?? null);
    setEditOpen(true);
  }

  async function handleSave(data: {
    attending: boolean;
    pickup_time: string | null;
    dropoff_time: string | null;
    pickup_mark: string | null;
    dropoff_mark: string | null;
  }) {
    if (!me || !editChild || !editDate) return;

    if (!data.attending) {
      // 非利用 = 削除相当
      if (editEntry) {
        const { error } = await supabase.from('schedule_entries').delete().eq('id', editEntry.id);
        if (error) { toast.error('削除に失敗しました', { description: error.message }); return; }
      }
      toast.success('予定を削除しました');
    } else {
      const payload = {
        tenant_id: me.tenant_id,
        facility_id: editChild.facility_id,
        child_id: editChild.id,
        date: editDate,
        pickup_time: data.pickup_time,
        dropoff_time: data.dropoff_time,
        pickup_mark: data.pickup_mark,
        dropoff_mark: data.dropoff_mark,
      };
      const { error } = await supabase
        .from('schedule_entries')
        .upsert(payload, { onConflict: 'tenant_id,facility_id,child_id,date' });
      if (error) { toast.error('保存に失敗しました', { description: error.message }); return; }
      toast.success('予定を保存しました');
    }
    setEditOpen(false);
    await loadEntries();
  }

  async function handleDelete() {
    if (!editEntry) return;
    const { error } = await supabase.from('schedule_entries').delete().eq('id', editEntry.id);
    if (error) { toast.error('削除に失敗しました', { description: error.message }); return; }
    toast.success('削除しました');
    setEditOpen(false);
    await loadEntries();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-diletto-gray">読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📅</span>
          <h1 className="text-2xl font-bold text-diletto-ink">利用予定</h1>
        </div>
      </div>

      {/* フィルタ + 月ステッパー */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-md border border-diletto-gray/10 p-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, -1))}>← 前月</Button>
          <div className="px-4 min-w-[140px] text-center font-bold text-diletto-ink">
            {format(month, 'yyyy年 M月', { locale: ja })}
          </div>
          <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, 1))}>次月 →</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { const d = new Date(); d.setDate(1); setMonth(d); }}
            className="text-xs text-diletto-gray-light"
          >
            今月
          </Button>
        </div>

        {scope === 'admin' && facilities.length > 1 && (
          <div className="flex items-center gap-2 ml-auto">
            <Label className="text-[10px] font-bold text-diletto-gray-light uppercase">事業所</Label>
            <select
              value={facilityFilter}
              onChange={(e) => setFacilityFilter(e.target.value)}
              className="h-9 rounded-md border border-diletto-gray/15 bg-white px-3 text-sm"
              aria-label="事業所フィルタ"
            >
              <option value="all">すべて</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-diletto-gray-light">
          <span>児童 {visibleChildren.length} 人</span>
          <span>·</span>
          <span>予定 {entries.filter((e) => visibleChildren.some((c) => c.id === e.child_id)).length} 件</span>
        </div>
      </div>

      {/* グリッド */}
      {visibleChildren.length === 0 ? (
        <Card className="border-dashed border-2 border-diletto-gray/20 bg-transparent rounded-md">
          <CardContent className="py-16 text-center text-diletto-gray-light">
            在籍中の児童がいません。先に「児童管理」で登録してください。
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-md border border-diletto-gray/10 overflow-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="bg-diletto-beige/50 sticky top-0 z-10">
                <th className="sticky left-0 z-20 bg-diletto-beige/95 border-r border-diletto-gray/15 px-3 py-2 text-left font-bold text-diletto-ink min-w-[140px]">
                  児童
                </th>
                {days.map((d) => {
                  const dow = d.getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  const isTodayFlag = isToday(d);
                  return (
                    <th
                      key={d.toISOString()}
                      className={`border-r border-diletto-gray/10 px-1 py-1 text-center min-w-[44px] font-normal ${
                        isTodayFlag ? 'bg-diletto-blue/10 text-diletto-blue font-bold' :
                        isWeekend ? 'bg-gray-50 text-diletto-gray-light' :
                        'text-diletto-gray'
                      }`}
                    >
                      <div className="text-xs">{format(d, 'd')}</div>
                      <div className="text-[10px] opacity-60">{format(d, 'E', { locale: ja })}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleChildren.map((child) => (
                <tr key={child.id} className="border-t border-diletto-gray/5 hover:bg-gray-50/30">
                  <td className="sticky left-0 bg-white border-r border-diletto-gray/15 px-3 py-2 min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-diletto-ink text-sm truncate">{child.name}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge className="bg-diletto-beige text-diletto-ink border-none text-[9px] px-1.5 py-0">
                        {GRADE_LABELS[child.grade_type]}
                      </Badge>
                    </div>
                  </td>
                  {days.map((d) => {
                    const dateStr = format(d, 'yyyy-MM-dd');
                    const entry = entryMap.get(`${child.id}|${dateStr}`);
                    const dow = d.getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    const pickupArea = entry?.pickup_mark
                      ? child.custom_pickup_areas?.find((a) => a.id === entry.pickup_mark)
                      : null;
                    const dropoffArea = entry?.dropoff_mark
                      ? child.custom_dropoff_areas?.find((a) => a.id === entry.dropoff_mark)
                      : null;
                    return (
                      <td
                        key={dateStr}
                        onClick={() => openCell(child, dateStr)}
                        className={`border-r border-b border-diletto-gray/5 p-1 text-center cursor-pointer transition-colors h-12 ${
                          entry ? 'bg-diletto-blue/5 hover:bg-diletto-blue/10' :
                          isWeekend ? 'bg-gray-50/50 hover:bg-gray-100' :
                          'hover:bg-diletto-beige/50'
                        }`}
                      >
                        {entry && (
                          <div className="flex flex-col gap-0 leading-tight">
                            {pickupArea && <span className="text-sm" title={`迎: ${pickupArea.name}`}>{pickupArea.emoji}</span>}
                            {!pickupArea && !dropoffArea && <span className="text-xs text-diletto-blue font-bold">✓</span>}
                            {dropoffArea && <span className="text-sm" title={`送: ${dropoffArea.name}`}>{dropoffArea.emoji}</span>}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ヘルプ */}
      <p className="text-xs text-diletto-gray-light">
        💡 セルをクリックして利用予定を登録・編集できます。絵文字は迎え/送りエリアを示します。
      </p>

      <ScheduleCellEditor
        open={editOpen}
        onOpenChange={setEditOpen}
        child={editChild}
        date={editDate}
        entry={editEntry}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
