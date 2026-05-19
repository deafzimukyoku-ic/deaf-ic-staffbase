'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { EmployeeProgress } from '@/lib/types';
import type { ReminderCategory } from '@/lib/email/reminder-email';

interface ProgressRow extends EmployeeProgress {
  last_name: string;
  first_name: string;
  last_name_kana?: string;
  first_name_kana?: string;
  status: string;
  email?: string;
  facility_id?: string | null;
}

interface FacilityLite { id: string; name: string; }

type CategoryKey = 'docs_submitted' | 'compliance_done' | 'trainings_passed' | 'announcements_read' | 'manuals_read';

const CATEGORY_META: Record<CategoryKey, { label: string; reminder: ReminderCategory }> = {
  docs_submitted: { label: '書類提出', reminder: 'documents' },
  compliance_done: { label: '遵守事項確認', reminder: 'compliance' },
  trainings_passed: { label: '研修完了', reminder: 'training' },
  announcements_read: { label: 'お知らせ既読', reminder: 'announcements' },
  manuals_read: { label: '業務マニュアル既読', reminder: 'manuals' },
};

type LastCompletedAt = Partial<Record<CategoryKey, Record<string, string>>>;

/* dashboard-published-filter:
   遵守事項 / 研修 / お知らせ / 業務マニュアル は is_published=true のみを母数に使う。
   - publishedTotals: 達成率分母・ProgressBadge total・ReminderModal の total に使用
   - allTotals: 概要カードの「公開件数 / 全件」表示の右側（分母）に使用
   書類 (totalTemplates) は document_templates に is_published 列が無く、
   audience rule で個別判定するため従来通り単一値で持つ。 */
interface CategoryTotals {
  compliance: number;
  trainings: number;
  announcements: number;
  manuals: number;
}

interface Props {
  rows: ProgressRow[];
  totalTemplates: number;
  /* 社員別の対象書類数。書類の自動判定（ゲート付きタグの AND）で社員ごとに対象数が異なるため。
     未指定の社員は totalTemplates を分母として fallback。 */
  docTotalsByEmployee?: Record<string, number>;
  /* 社員別の 4 機能 (compliance/training/announcement/manual) 対象数。
     facility 兼任 + position フィルタ込みで per-employee に計算した分母。
     未指定の社員は publishedTotals を分母として fallback (= 全公開件数)。 */
  publishedTotalsByEmployee?: Record<string, CategoryTotals>;
  publishedTotals: CategoryTotals;
  allTotals: CategoryTotals;
  facilities?: FacilityLite[];
  lastCompletedAt?: LastCompletedAt;
}

function formatJpDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-2 text-sm font-bold text-brand-ink hover:text-brand-blue transition-colors"
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

export function ProgressDashboard({ rows, totalTemplates, docTotalsByEmployee = {}, publishedTotalsByEmployee = {}, publishedTotals, allTotals, facilities = [], lastCompletedAt = {} }: Props) {
  /* per-row 分母 helper: publishedTotalsByEmployee 未指定の社員 (= 古いキャッシュ等) は
     publishedTotals (全公開件数) を分母として fallback する。新ロジック適用後は
     全社員に対して per-employee の値が入る想定。 */
  const totalsFor = (employeeId: string): CategoryTotals =>
    publishedTotalsByEmployee[employeeId] ?? publishedTotals;
  /* 進捗一覧は従業員番号順 (社員番号は string だが数字主体のため数値変換できる場合は数値比較、
     それ以外は文字列比較、未設定 (NULL / 空) は末尾) */
  const active = rows
    .filter((r) => r.status === 'active')
    .sort((a, b) => {
      const an = String((a as { employee_number?: string }).employee_number ?? '').trim();
      const bn = String((b as { employee_number?: string }).employee_number ?? '').trim();
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      const aNum = Number(an);
      const bNum = Number(bn);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
      return an.localeCompare(bn, 'ja');
    });

  // モーダル状態
  const [openKey, setOpenKey] = useState<CategoryKey | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  function openModal(key: CategoryKey) {
    setOpenKey(key);
    setSelectedIds(new Set());
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (!openKey || selectedIds.size === 0) return;
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

  // 達成率を計算（社員ごとの分母を受け取る版。書類は社員ごとに対象数が違う）
  const calcRate = (key: CategoryKey, totalOf: (r: ProgressRow) => number) => {
    if (active.length === 0) return 0;
    let denominator = 0;
    let numerator = 0;
    for (const r of active) {
      const t = totalOf(r);
      if (t === 0) continue; /* 対象 0 件の社員は分母分子から外す（達成率計算の意味がない） */
      denominator++;
      numerator += Math.min(Number(r[key as keyof EmployeeProgress] ?? 0) / t, 1);
    }
    if (denominator === 0) return 0;
    return Math.round((numerator / denominator) * 100);
  };

  const docRate = calcRate('docs_submitted', (r) => docTotalsByEmployee[r.employee_id] ?? totalTemplates);
  const compRate = calcRate('compliance_done', (r) => totalsFor(r.employee_id).compliance);
  const trainRate = calcRate('trainings_passed', (r) => totalsFor(r.employee_id).trainings);
  const annRate = calcRate('announcements_read', (r) => totalsFor(r.employee_id).announcements);
  const manualRate = calcRate('manuals_read', (r) => totalsFor(r.employee_id).manuals);

  return (
    <div className="space-y-5">
      {/* 達成率カード — 5列レスポンシブ */}
      <CollapsibleSection title="達成率">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <RateCard label="書類提出率" pct={docRate} color="text-brand-blue" ring="border-brand-blue" onClick={() => openModal('docs_submitted')} />
          <RateCard label="遵守事項確認率" pct={compRate} color="text-brand-green" ring="border-brand-green" onClick={() => openModal('compliance_done')} />
          <RateCard label="研修完了率" pct={trainRate} color="text-brand-gold" ring="border-brand-gold" onClick={() => openModal('trainings_passed')} />
          <RateCard label="お知らせ既読率" pct={annRate} color="text-brand-ink" ring="border-brand-ink" onClick={() => openModal('announcements_read')} />
          <RateCard label="業務マニュアル既読率" pct={manualRate} color="text-purple-600" ring="border-purple-600" onClick={() => openModal('manuals_read')} />
        </div>
      </CollapsibleSection>

      {/* リマインドモーダル */}
      {openKey && <ReminderModal
        openKey={openKey}
        rows={active}
        facilities={facilities}
        totals={{
          docs_submitted: totalTemplates,
          compliance_done: publishedTotals.compliance,
          trainings_passed: publishedTotals.trainings,
          announcements_read: publishedTotals.announcements,
          manuals_read: publishedTotals.manuals,
        }}
        docTotalsByEmployee={docTotalsByEmployee}
        publishedTotalsByEmployee={publishedTotalsByEmployee}
        lastCompletedAt={lastCompletedAt}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        sending={sending}
        onClose={() => setOpenKey(null)}
        onToggle={toggle}
        onSend={handleSend}
      />}

      {/* サマリーカード — 5列レスポンシブ。
          書類は is_published 概念なしのため value のみ。それ以外は "公開件数 / 全件" 表示 */}
      <CollapsibleSection title="概要">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <StatCard label="社員数" value={active.length} sub="在籍" />
          <StatCard label="遵守事項"   value={publishedTotals.compliance}    total={allTotals.compliance}    sub="件" />
          <StatCard label="研修"       value={publishedTotals.trainings}     total={allTotals.trainings}     sub="件" />
          <StatCard label="お知らせ"   value={publishedTotals.announcements} total={allTotals.announcements} sub="件" />
          <StatCard label="業務マニュアル" value={publishedTotals.manuals}   total={allTotals.manuals}       sub="件" />
        </div>
      </CollapsibleSection>

      {/* 進捗テーブル */}
      <CollapsibleSection title="社員進捗一覧">
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-brand-gray-light">
                    <th className="py-2 pr-4 whitespace-nowrap min-w-[7em]">社員名</th>
                    <th className="py-2 px-4 text-center whitespace-nowrap">書類</th>
                    <th className="py-2 px-4 text-center whitespace-nowrap">遵守事項</th>
                    <th className="py-2 px-4 text-center whitespace-nowrap">研修</th>
                    <th className="py-2 px-4 text-center whitespace-nowrap">お知らせ</th>
                    <th className="py-2 px-4 text-center whitespace-nowrap">業務マニュアル</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((r) => {
                    const rowTotals = totalsFor(r.employee_id);
                    return (
                      <tr key={r.employee_id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium whitespace-nowrap min-w-[7em]">
                          <Link href={`/admin/employees/${r.employee_id}`} className="hover:text-brand-blue transition-colors">
                            {r.last_name} {r.first_name}
                          </Link>
                        </td>
                        <td className="py-2 px-4 text-center">
                          <ProgressBadge current={Number(r.docs_submitted)} total={docTotalsByEmployee[r.employee_id] ?? totalTemplates} />
                        </td>
                        <td className="py-2 px-4 text-center">
                          <ProgressBadge current={Number(r.compliance_done)} total={rowTotals.compliance} />
                        </td>
                        <td className="py-2 px-4 text-center">
                          <ProgressBadge current={Number(r.trainings_passed)} total={rowTotals.trainings} />
                        </td>
                        <td className="py-2 px-4 text-center">
                          <ProgressBadge current={Number(r.announcements_read)} total={rowTotals.announcements} />
                        </td>
                        <td className="py-2 px-4 text-center">
                          <ProgressBadge current={Number((r as { manuals_read?: number }).manuals_read ?? 0)} total={rowTotals.manuals} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {active.length === 0 && (
                <p className="text-center py-8 text-brand-gray-light">社員がまだ登録されていません</p>
              )}
            </div>
          </CardContent>
        </Card>
      </CollapsibleSection>
    </div>
  );
}

/* total を渡すと "公開件数 / 全件" 表示、未指定なら従来の単一件数 (書類 / 社員数) */
function StatCard({ label, value, total, sub }: { label: string; value: number; total?: number; sub: string }) {
  return (
    <Card>
      <CardContent className="py-4 text-center">
        <p className="text-2xl font-bold">
          {value}
          {total !== undefined && <span className="text-brand-gray-light font-normal text-xl"> / {total}</span>}
        </p>
        <p className="text-xs text-brand-gray-light">{label} {sub}</p>
      </CardContent>
    </Card>
  );
}

function RateCard({ label, pct, color, ring, onClick }: { label: string; pct: number; color: string; ring: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded-lg"
    >
      <Card className={`border-2 ${ring} transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer`}>
        <CardContent className="py-5 text-center">
          <p className={`text-3xl font-bold ${color}`}>{pct}%</p>
          <p className="text-xs text-brand-gray-light mt-1">{label}</p>
          <p className="text-[10px] text-brand-blue mt-2">未完了者を見る →</p>
        </CardContent>
      </Card>
    </button>
  );
}

function ReminderModal({
  openKey, rows, facilities, totals, docTotalsByEmployee, publishedTotalsByEmployee, lastCompletedAt, selectedIds, setSelectedIds, sending, onClose, onToggle, onSend,
}: {
  openKey: CategoryKey;
  rows: ProgressRow[];
  facilities: FacilityLite[];
  totals: Record<CategoryKey, number>;
  /* 書類だけ社員別の対象数があるので別経路で受ける */
  docTotalsByEmployee: Record<string, number>;
  /* 4 機能 (compliance/training/announcement/manual) の per-employee 対象数 */
  publishedTotalsByEmployee: Record<string, CategoryTotals>;
  lastCompletedAt: LastCompletedAt;
  selectedIds: Set<string>;
  setSelectedIds: (next: Set<string>) => void;
  sending: boolean;
  onClose: () => void;
  onToggle: (id: string) => void;
  onSend: () => void;
}) {
  const meta = CATEGORY_META[openKey];
  const total = totals[openKey];
  /* 社員ごとの「対象数」を取得するヘルパー。書類 + 4 機能とも per-employee の値があれば
     それを優先、なければ全社員共通 fallback。これで「対象外社員が未完了として残る」を解消。 */
  const totalFor = (r: ProgressRow): number => {
    if (openKey === 'docs_submitted') return docTotalsByEmployee[r.employee_id] ?? total;
    const perEmp = publishedTotalsByEmployee[r.employee_id];
    if (!perEmp) return total;
    if (openKey === 'compliance_done') return perEmp.compliance;
    if (openKey === 'trainings_passed') return perEmp.trainings;
    if (openKey === 'announcements_read') return perEmp.announcements;
    if (openKey === 'manuals_read') return perEmp.manuals;
    return total;
  };
  const incomplete = rows.filter((r) => totalFor(r) > 0 && Number(r[openKey]) < totalFor(r));
  const completed = rows.filter((r) => totalFor(r) > 0 && Number(r[openKey]) >= totalFor(r));

  const [search, setSearch] = useState('');
  const [facilityFilter, setFacilityFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'incomplete' | 'complete'>('incomplete');

  const facilityMap = new Map(facilities.map((f) => [f.id, f.name]));

  const baseList = viewMode === 'incomplete' ? incomplete : completed;
  const visible = baseList.filter((r) => {
    if (facilityFilter === '__none__') {
      if (r.facility_id) return false;
    } else if (facilityFilter !== 'all') {
      if (r.facility_id !== facilityFilter) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const hay = `${r.last_name}${r.first_name}${r.last_name_kana || ''}${r.first_name_kana || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const visibleAllSelected = visible.length > 0 && visible.every((r) => selectedIds.has(r.employee_id));

  function toggleVisibleAll(checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) visible.forEach((r) => next.add(r.employee_id));
    else visible.forEach((r) => next.delete(r.employee_id));
    setSelectedIds(next);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{meta.label} — 未完了 {incomplete.length}名 / 完了 {completed.length}名</DialogTitle>
        </DialogHeader>

        {total === 0 ? (
          <p className="py-8 text-center text-sm text-brand-gray-light">対象項目が登録されていません</p>
        ) : (
          <>
            <div className="flex gap-1 p-1 bg-brand-beige/40 rounded-md">
              <button
                type="button"
                onClick={() => setViewMode('incomplete')}
                className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${viewMode === 'incomplete' ? 'bg-white shadow-sm text-brand-ink' : 'text-brand-gray-light hover:text-brand-ink'}`}
              >
                未完了 ({incomplete.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('complete')}
                className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${viewMode === 'complete' ? 'bg-white shadow-sm text-brand-ink' : 'text-brand-gray-light hover:text-brand-ink'}`}
              >
                完了 ({completed.length})
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="氏名・カナで検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 rounded-md border border-brand-gray/20 bg-white px-2.5 text-sm focus:outline-none focus:border-brand-blue"
              />
              <select
                value={facilityFilter}
                onChange={(e) => setFacilityFilter(e.target.value)}
                className="h-9 rounded-md border border-brand-gray/20 bg-white px-2 text-sm"
                title="施設で絞り込み"
              >
                <option value="all">すべての施設</option>
                <option value="__none__">未所属</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {viewMode === 'incomplete' && (
              <div className="flex items-center gap-2 pb-2 border-b border-brand-gray/10">
                <label className="flex items-center gap-2 text-xs text-brand-gray cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-blue"
                    checked={visibleAllSelected}
                    onChange={(e) => toggleVisibleAll(e.target.checked)}
                  />
                  表示中の{visible.length}名を全選択
                </label>
                <span className="text-xs text-brand-gray-light ml-auto">{selectedIds.size}名 選択中</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[55vh] divide-y divide-brand-gray/10">
              {visible.length === 0 ? (
                <p className="py-8 text-center text-xs text-brand-gray-light">
                  {viewMode === 'incomplete' ? '該当する社員がいません' : '完了した社員がいません'}
                </p>
              ) : visible.map((r) => {
                const lastIso = viewMode === 'complete' ? lastCompletedAt[openKey]?.[r.employee_id] : undefined;
                const lastLabel = openKey === 'docs_submitted' ? '提出' : '確認';
                return (
                  <label key={r.employee_id} className={`flex items-center gap-3 py-2 px-1 rounded ${viewMode === 'incomplete' ? 'cursor-pointer hover:bg-brand-beige/50' : ''}`}>
                    {viewMode === 'incomplete' && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-blue"
                        checked={selectedIds.has(r.employee_id)}
                        onChange={() => onToggle(r.employee_id)}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <Link href={`/admin/employees/${r.employee_id}`} className="text-sm font-medium hover:text-brand-blue transition-colors">
                        {r.last_name} {r.first_name}
                      </Link>
                      <div className="text-[10px] text-brand-gray-light">
                        {r.facility_id && <>{facilityMap.get(r.facility_id) || '-'}</>}
                        {lastIso && <span className="ml-2">📅 最終{lastLabel}: {formatJpDate(lastIso)}</span>}
                      </div>
                    </div>
                    <Badge className={viewMode === 'incomplete'
                      ? 'bg-brand-gold/[0.08] text-brand-gold text-[10px] shrink-0'
                      : 'bg-brand-green/10 text-brand-green text-[10px] shrink-0'}>
                      {Number(r[openKey])} / {totalFor(r)}
                    </Badge>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>閉じる</Button>
          {viewMode === 'incomplete' && incomplete.length > 0 && (
            <Button onClick={onSend} disabled={sending || selectedIds.size === 0}>
              {sending ? '送信中...' : `${selectedIds.size}名にリマインド送信`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBadge({ current, total }: { current: number; total: number }) {
  if (total === 0) return <span className="text-brand-gray-light">-</span>;
  const done = current >= total;
  return (
    <Badge className={done
      ? 'bg-brand-green/10 text-brand-green'
      : 'bg-brand-gold/[0.08] text-brand-gold'
    }>
      {current}/{total}
    </Badge>
  );
}
