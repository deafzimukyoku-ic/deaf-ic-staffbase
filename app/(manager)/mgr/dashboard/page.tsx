'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import Link from 'next/link';
import { useShiftFacilityId } from '@/lib/shift-facility';

interface ProgressRow {
  employee_id: string;
  tenant_id: string;
  last_name: string;
  first_name: string;
  last_name_kana?: string;
  first_name_kana?: string;
  status: string;
  facility_id: string | null;
  docs_submitted: number;
  compliance_done: number;
  trainings_passed: number;
  announcements_read: number;
  manuals_read: number;
}

interface FacilityLite { id: string; name: string; }

type CategoryKey = 'docs_submitted' | 'compliance_done' | 'trainings_passed' | 'announcements_read' | 'manuals_read';

const CATEGORY_META: Record<CategoryKey, { label: string; reminder: string }> = {
  docs_submitted: { label: '書類提出', reminder: 'documents' },
  compliance_done: { label: '遵守事項確認', reminder: 'compliance' },
  trainings_passed: { label: '研修完了', reminder: 'training' },
  announcements_read: { label: 'お知らせ既読', reminder: 'announcements' },
  manuals_read: { label: '業務マニュアル既読', reminder: 'manuals' },
};

function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-2 text-sm font-bold text-diletto-ink hover:text-diletto-blue transition-colors"
      >
        <span>{title}</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default function ManagerDashboardPage() {
  const [me, setMe] = useState<{ id: string; tenant_id: string; facility_id: string | null } | null>(null);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityLite[]>([]);
  const [totals, setTotals] = useState({ docs: 0, compliance: 0, trainings: 0, announcements: 0, manuals: 0 });
  const [lastCompletedAt, setLastCompletedAt] = useState<Partial<Record<CategoryKey, Record<string, string>>>>({});
  const [loading, setLoading] = useState(true);
  const [facilityId] = useShiftFacilityId();

  // モーダル
  const [openKey, setOpenKey] = useState<CategoryKey | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: meData } = await supabase
        .from('employees')
        .select('id, tenant_id, facility_id')
        .eq('auth_user_id', user.id)
        .single();
      if (!meData) return;
      setMe(meData as any);

      // 担当施設取得
      const { data: facs } = await supabase
        .from('manager_facilities')
        .select('facility:facilities(id, name), facility_id')
        .eq('employee_id', meData.id);

      const mfs = (facs || []).map((f: any) => ({ id: f.facility_id, name: f.facility?.name })).filter((f: any) => f.name);
      const facilityIds = mfs.map((f) => f.id);

      if (meData.facility_id && !facilityIds.includes(meData.facility_id)) {
        const { data: affFac } = await supabase.from('facilities').select('id, name').eq('id', meData.facility_id).single();
        if (affFac) {
          mfs.unshift({ id: affFac.id, name: affFac.name });
          facilityIds.unshift(affFac.id);
        }
      }
      setFacilities(mfs);

      if (facilityIds.length === 0) {
        setLoading(false);
        return;
      }

      const tid = meData.tenant_id;

      // 各種データ取得
      const [progressRes, templatesRes, complianceRes, trainingsRes, announcementsRes, manualsRes, employeesRes, docSubsRes, compAcksRes, trainSubsRes, annReadsRes, manualReadsRes] = await Promise.all([
        supabase.from('employee_progress').select('*').eq('tenant_id', tid).in('facility_id', facilityIds).neq('employee_id', meData.id),
        supabase.from('document_templates').select('id').eq('tenant_id', tid),
        supabase.from('compliance_documents').select('id').eq('tenant_id', tid),
        supabase.from('trainings').select('id').eq('tenant_id', tid),
        supabase.from('announcements').select('id').eq('tenant_id', tid),
        supabase.from('manuals').select('id').eq('tenant_id', tid),
        supabase.from('employees').select('id, last_name, first_name, last_name_kana, first_name_kana, status, facility_id').eq('tenant_id', tid).in('facility_id', facilityIds).neq('id', meData.id),
        supabase.from('document_submissions').select('employee_id, submitted_at').eq('status', 'submitted'),
        supabase.from('compliance_acknowledgments').select('employee_id, acknowledged_at'),
        supabase.from('training_submissions').select('employee_id, submitted_at').eq('result', 'passed'),
        supabase.from('announcement_reads').select('employee_id, read_at'),
        supabase.from('manual_reads').select('employee_id, read_at'),
      ]);

      const empMap = new Map((employeesRes.data || []).map((e: any) => [e.id, e]));
      const pRows = (progressRes.data || []).map((p: any) => {
        const emp = empMap.get(p.employee_id) || {};
        return {
          ...p,
          last_name: emp.last_name || '-',
          first_name: emp.first_name || '',
          last_name_kana: emp.last_name_kana,
          first_name_kana: emp.first_name_kana,
          status: emp.status || 'active',
          facility_id: emp.facility_id
        };
      });

      setRows(pRows);
      setTotals({
        docs: templatesRes.data?.length || 0,
        compliance: complianceRes.data?.length || 0,
        trainings: trainingsRes.data?.length || 0,
        announcements: announcementsRes.data?.length || 0,
        manuals: manualsRes.data?.length || 0,
      });

      function buildLastMap(records: any[] | null | undefined, dateCol: string): Record<string, string> {
        const map: Record<string, string> = {};
        for (const r of records || []) {
          const ts = r[dateCol];
          if (!ts) continue;
          const cur = map[r.employee_id];
          if (!cur || ts > cur) map[r.employee_id] = ts;
        }
        return map;
      }
      setLastCompletedAt({
        docs_submitted: buildLastMap(docSubsRes.data, 'submitted_at'),
        compliance_done: buildLastMap(compAcksRes.data, 'acknowledged_at'),
        trainings_passed: buildLastMap(trainSubsRes.data, 'submitted_at'),
        announcements_read: buildLastMap(annReadsRes.data, 'read_at'),
        manuals_read: buildLastMap(manualReadsRes.data, 'read_at'),
      });
      setLoading(false);
    }
    load();
  }, []);

  const active = rows.filter(r => r.status === 'active');
  const filteredActive = facilityId ? active.filter(r => r.facility_id === facilityId) : active;

  const calcRate = (key: CategoryKey, total: number) => {
    if (filteredActive.length === 0 || total === 0) return 0;
    const sum = filteredActive.reduce((acc, r) => acc + Math.min(Number(r[key]) / total, 1), 0);
    return Math.round((sum / filteredActive.length) * 100);
  };

  const docRate = calcRate('docs_submitted', totals.docs);
  const compRate = calcRate('compliance_done', totals.compliance);
  const trainRate = calcRate('trainings_passed', totals.trainings);
  const annRate = calcRate('announcements_read', totals.announcements);
  const manualRate = calcRate('manuals_read', totals.manuals);

  async function handleSendReminder() {
    if (!openKey || selectedIds.size === 0 || !me) return;
    setSending(true);
    const res = await fetch('/api/admin/send-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: CATEGORY_META[openKey].reminder,
        employee_ids: Array.from(selectedIds),
      }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok) {
      toast.error('送信に失敗しました', { description: json.error });
      return;
    }
    toast.success(`${json.sent}名にリマインドを送信しました`);
    setOpenKey(null);
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-diletto-ink">ダッシュボード</h1>
        <p className="text-xs text-diletto-gray-light mt-1 italic">Managerial Overview</p>
      </div>

      {facilities.length === 0 ? (
        <Card className="border-dashed border-2 border-diletto-gray/20 rounded-xl">
          <CardContent className="py-20 text-center">
            <p className="text-diletto-gray font-bold">担当施設が設定されていません</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <CollapsibleSection title="達成率">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
              <RateCard label="書類提出率" pct={docRate} color="text-diletto-blue" ring="border-diletto-blue" onClick={() => setOpenKey('docs_submitted')} />
              <RateCard label="遵守事項確認率" pct={compRate} color="text-diletto-green" ring="border-diletto-green" onClick={() => setOpenKey('compliance_done')} />
              <RateCard label="研修完了率" pct={trainRate} color="text-diletto-gold" ring="border-diletto-gold" onClick={() => setOpenKey('trainings_passed')} />
              <RateCard label="お知らせ既読率" pct={annRate} color="text-diletto-ink" ring="border-diletto-ink" onClick={() => setOpenKey('announcements_read')} />
              <RateCard label="業務マニュアル既読率" pct={manualRate} color="text-purple-600" ring="border-purple-600" onClick={() => setOpenKey('manuals_read')} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="概要">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
              <StatCard label="社員数" value={active.length} sub="在籍" />
              <StatCard label="遵守事項" value={totals.compliance} sub="件" />
              <StatCard label="研修" value={totals.trainings} sub="件" />
              <StatCard label="お知らせ" value={totals.announcements} sub="件" />
              <StatCard label="業務マニュアル" value={totals.manuals} sub="件" />
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="社員進捗一覧">
            <Card className="rounded-xl border-diletto-gray/5 bg-white shadow-sm overflow-hidden">
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-diletto-gray-light uppercase font-bold tracking-wider">
                        <th className="py-3 pr-4">社員名</th>
                        <th className="py-3 px-4 text-center">書類</th>
                        <th className="py-3 px-4 text-center">遵守事項</th>
                        <th className="py-3 px-4 text-center">研修</th>
                        <th className="py-3 px-4 text-center">お知らせ</th>
                        <th className="py-3 px-4 text-center">業務マニュアル</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-diletto-gray/5">
                      {filteredActive.map((r) => (
                        <tr key={r.employee_id} className="hover:bg-diletto-beige/20 transition-colors">
                          <td className="py-3 pr-4 font-bold">
                            <Link href={`/mgr/subordinates?id=${r.employee_id}`} className="hover:text-diletto-blue transition-colors">
                              {r.last_name} {r.first_name}
                            </Link>
                          </td>
                          <td className="py-3 px-4 text-center"><ProgressBadge current={r.docs_submitted} total={totals.docs} /></td>
                          <td className="py-3 px-4 text-center"><ProgressBadge current={r.compliance_done} total={totals.compliance} /></td>
                          <td className="py-3 px-4 text-center"><ProgressBadge current={r.trainings_passed} total={totals.trainings} /></td>
                          <td className="py-3 px-4 text-center"><ProgressBadge current={r.announcements_read} total={totals.announcements} /></td>
                          <td className="py-3 px-4 text-center"><ProgressBadge current={r.manuals_read} total={totals.manuals} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredActive.length === 0 && <p className="text-center py-10 text-diletto-gray-light font-medium italic">社員がまだ登録されていません</p>}
                </div>
              </CardContent>
            </Card>
          </CollapsibleSection>

          {/* モーダル */}
          {openKey && (
            <ReminderModal
              openKey={openKey}
              rows={filteredActive}
              facilities={facilities}
              total={openKey === 'docs_submitted' ? totals.docs : openKey === 'compliance_done' ? totals.compliance : openKey === 'trainings_passed' ? totals.trainings : openKey === 'announcements_read' ? totals.announcements : totals.manuals}
              lastCompletedAt={lastCompletedAt}
              selectedIds={selectedIds}
              onClose={() => setOpenKey(null)}
              onToggle={(id: string) => {
                const next = new Set(selectedIds);
                if (next.has(id)) next.delete(id); else next.add(id);
                setSelectedIds(next);
              }}
              onSelectAll={(ids: string[]) => setSelectedIds(new Set(ids))}
              onSend={handleSendReminder}
              sending={sending}
            />
          )}

        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <Card>
      <CardContent className="py-4 text-center">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-diletto-gray-light">{label} {sub}</p>
      </CardContent>
    </Card>
  );
}

function RateCard({ label, pct, color, ring, onClick }: { label: string; pct: number; color: string; ring: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-diletto-blue rounded-lg"
    >
      <Card className={`border-2 ${ring} transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer`}>
        <CardContent className="py-5 text-center">
          <p className={`text-3xl font-bold ${color}`}>{pct}%</p>
          <p className="text-xs text-diletto-gray-light mt-1">{label}</p>
          <p className="text-[10px] text-diletto-blue mt-2">未完了者を見る →</p>
        </CardContent>
      </Card>
    </button>
  );
}

function ProgressBadge({ current, total }: { current: number; total: number }) {
  if (total === 0) return <span className="text-diletto-gray-light">-</span>;
  const done = current >= total;
  return (
    <Badge className={done ? 'bg-diletto-green/10 text-diletto-green border-none' : 'bg-diletto-gold/[0.08] text-diletto-gold border-none'}>
      {current}/{total}
    </Badge>
  );
}

function ReminderModal({ openKey, rows, facilities, total, lastCompletedAt, selectedIds, onClose, onToggle, onSelectAll, onSend, sending }: any) {
  const meta = CATEGORY_META[openKey as CategoryKey];
  const incomplete = rows.filter((r: any) => Number(r[openKey]) < total);
  const completed = rows.filter((r: any) => Number(r[openKey]) >= total && total > 0);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'incomplete' | 'complete'>('incomplete');

  const baseList = viewMode === 'incomplete' ? incomplete : completed;
  const visible = baseList.filter((r: any) => {
    const q = search.toLowerCase();
    return `${r.last_name}${r.first_name}${r.last_name_kana || ''}${r.first_name_kana || ''}`.toLowerCase().includes(q);
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{meta.label} — 未完了 {incomplete.length}名 / 完了 {completed.length}名</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-hidden pt-4">
          <div className="flex gap-1 p-1 bg-diletto-beige/40 rounded-md">
            <button
              type="button"
              onClick={() => setViewMode('incomplete')}
              className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${viewMode === 'incomplete' ? 'bg-white shadow-sm text-diletto-ink' : 'text-diletto-gray-light hover:text-diletto-ink'}`}
            >
              未完了 ({incomplete.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('complete')}
              className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${viewMode === 'complete' ? 'bg-white shadow-sm text-diletto-ink' : 'text-diletto-gray-light hover:text-diletto-ink'}`}
            >
              完了 ({completed.length})
            </button>
          </div>

          <input type="text" placeholder="名前で検索" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 rounded-md border border-diletto-gray/20 bg-white px-2.5 text-sm outline-none" />

          {viewMode === 'incomplete' && (
            <div className="flex items-center justify-between text-xs text-diletto-gray border-b border-diletto-gray/10 pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded accent-diletto-blue" checked={visible.length > 0 && visible.every((r: any) => selectedIds.has(r.employee_id))} onChange={(e) => {
                  const next = new Set(selectedIds);
                  if (e.target.checked) visible.forEach((r: any) => next.add(r.employee_id));
                  else visible.forEach((r: any) => next.delete(r.employee_id));
                  onSelectAll(Array.from(next));
                }} />
                <span>表示中の{visible.length}名を全選択</span>
              </label>
              <span>{selectedIds.size}名 選択中</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[55vh] divide-y divide-diletto-gray/10">
            {visible.length === 0 ? (
              <p className="py-8 text-center text-xs text-diletto-gray-light">
                {viewMode === 'incomplete' ? '該当する社員がいません' : '完了した社員がいません'}
              </p>
            ) : visible.map((r: any) => {
              const lastIso = viewMode === 'complete' ? lastCompletedAt?.[openKey]?.[r.employee_id] : undefined;
              const lastLabel = openKey === 'docs_submitted' ? '提出' : '確認';
              const fmt = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
              return (
                <label key={r.employee_id} className={`flex items-center gap-3 py-2 px-1 rounded ${viewMode === 'incomplete' ? 'cursor-pointer hover:bg-diletto-beige/50' : ''}`}>
                  {viewMode === 'incomplete' && (
                    <input type="checkbox" className="w-4 h-4 rounded accent-diletto-blue" checked={selectedIds.has(r.employee_id)} onChange={() => onToggle(r.employee_id)} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{r.last_name} {r.first_name}</p>
                    <p className="text-[10px] text-diletto-gray-light">
                      {facilities.find((f: any) => f.id === r.facility_id)?.name || '-'}
                      {lastIso && <span className="ml-2">📅 最終{lastLabel}: {fmt(lastIso)}</span>}
                    </p>
                  </div>
                  <Badge className={viewMode === 'incomplete'
                    ? 'bg-diletto-gold/[0.08] text-diletto-gold text-[10px] border-none'
                    : 'bg-diletto-green/10 text-diletto-green text-[10px] border-none'}>
                    {r[openKey]} / {total}
                  </Badge>
                </label>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>閉じる</Button>
          {viewMode === 'incomplete' && incomplete.length > 0 && (
            <Button onClick={onSend} disabled={sending || selectedIds.size === 0} className="bg-diletto-ink hover:bg-black text-white px-6 shadow-sm">
              {sending ? '送信中...' : 'リマインドを送信'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
