'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { TrainingPlayer } from '@/components/employee/TrainingPlayer';
import { CategoryBadge } from '@/components/admin/CategorySelect';
import { applyScopeFilter } from '@/components/admin/FacilityScopeSelector';
import { TRAINING_SUMMARY_MIN_CHARS } from '@/lib/constants';
import { toast } from 'sonner';
import type { Training, TrainingSubmission, Category } from '@/lib/types';
import { NewBadge } from '@/components/admin/NewBadge';
import { BlockRenderer } from '@/components/admin/BlockRenderer';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchMyViewSummary, logView, type ViewSummary } from '@/lib/view-log';
import { ViewConfirmButton } from '@/components/employee/ViewConfirmButton';
import { ItemGridCard, blocksToExcerpt, blocksHaveMedia } from '@/components/employee/ItemGridCard';
import { fetchMyFacilityIds, facilityTargetsMatchMine } from '@/lib/multi-facility';

interface TrainingWithSub {
  training: Training;
  submission: TrainingSubmission | null;
}

/* 結果ラベル/色 はモジュールレベルに置く (TrainingsGrid を module level に出すため) */
const RESULT_LABEL: Record<string, string> = { pending: '判定待ち', passed: '合格', failed: '不合格', resubmit: '再提出してください' };
const RESULT_COLOR: Record<string, string> = {
  pending: 'bg-diletto-gold/[0.08] text-diletto-gold',
  passed: 'bg-diletto-green/10 text-diletto-green',
  failed: 'bg-diletto-red/[0.06] text-diletto-red',
  resubmit: 'bg-diletto-blue/[0.07] text-diletto-blue',
};

/* TrainingsGrid: 受講モーダルを含むカテゴリ別グリッド。
   親 MyTrainingsPage の nested function として定義すると、Textarea の onChange で
   親 state (summaryTexts) を更新するたびに親が再レンダー → React が新しい関数参照を
   見て TrainingsGrid を unmount + remount → useState(null) で openId がリセット
   → Dialog が閉じる、というバグになる。必ず module level に置くこと。 */
function TrainingsGrid({
  items, summaryTexts, setSummaryTexts, submittingId, onSubmit,
  tenantId, employeeId, viewSummaries,
}: {
  items: TrainingWithSub[];
  summaryTexts: Record<string, string>;
  setSummaryTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  submittingId: string | null;
  onSubmit: (id: string) => void;
  tenantId: string | null;
  employeeId: string | null;
  viewSummaries: Map<string, ViewSummary>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  /* モーダルを開いた瞬間の submission 有無を記録（同セッション中は変化しない） */
  const [wasSubmittedAtOpen, setWasSubmittedAtOpen] = useState<boolean>(false);
  const open = openId ? items.find((i) => i.training.id === openId) : null;

  if (items.length === 0) {
    return <p className="text-center py-20 text-diletto-gray-light">このカテゴリの研修はありません</p>;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
        {items.map(({ training, submission }) => {
          const passed = submission?.result === 'passed';
          const label = submission ? RESULT_LABEL[submission.result] : '未受講';
          return (
            <ItemGridCard
              key={training.id}
              title={training.title}
              excerpt={blocksToExcerpt((training as any).content_blocks, (training as any).body)}
              createdAt={training.created_at}
              acknowledged={passed}
              ackLabel="合格"
              pendingLabel={label}
              hasMedia={blocksHaveMedia((training as any).content_blocks) || !!training.youtube_url || !!training.pdf_storage_path}
              onClick={() => {
                setWasSubmittedAtOpen(!!submission);
                setOpenId(training.id);
              }}
            />
          );
        })}
      </div>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="!max-w-6xl sm:!max-w-6xl max-h-[90vh] overflow-y-auto">
          {open && (() => {
            const { training, submission } = open;
            const canResubmit = submission?.result === 'resubmit' || submission?.result === 'failed';
            const showForm = !submission || canResubmit;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <DialogTitle className="text-lg font-bold">{training.title}</DialogTitle>
                      <NewBadge createdAt={training.created_at} />
                    </div>
                    {submission && (
                      <Badge className={`${RESULT_COLOR[submission.result]} border-none`}>
                        {RESULT_LABEL[submission.result]}
                      </Badge>
                    )}
                  </div>
                </DialogHeader>

                <div className="space-y-4 pt-2">
                  {(training as any).body && (
                    <p className="text-sm text-diletto-ink/80 leading-relaxed">{(training as any).body}</p>
                  )}

                  {((training as any).content_blocks?.length || 0) > 0 ? (
                    <div className="bg-white/80 rounded-md p-5 border border-diletto-gray/10">
                      <BlockRenderer blocks={(training as any).content_blocks} />
                    </div>
                  ) : (
                    <div className="rounded-md overflow-hidden shadow-lg border border-white">
                      <TrainingPlayer
                        title={training.title}
                        youtubeUrl={training.youtube_url}
                        pdfUrl={training.pdf_storage_path}
                      />
                    </div>
                  )}

                  {submission && submission.admin_comment && (
                    <div className="bg-white/60 backdrop-blur-sm border border-diletto-blue/20 p-4 rounded-md text-sm flex gap-3">
                      <span className="text-diletto-blue font-bold">💡 判定コメント:</span>
                      <span className="text-diletto-ink">{submission.admin_comment}</span>
                    </div>
                  )}

                  {showForm && (
                    <Card className="border-none shadow-sm bg-white/80 backdrop-blur-sm">
                      <CardContent className="py-6 space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between items-end">
                            <Label className="text-sm font-bold">受講の感想</Label>
                            <span className={`text-[10px] font-medium ${(summaryTexts[training.id] || '').length < TRAINING_SUMMARY_MIN_CHARS ? 'text-diletto-red' : 'text-diletto-green'}`}>
                              {(summaryTexts[training.id] || '').length} / {TRAINING_SUMMARY_MIN_CHARS} 文字以上
                            </span>
                          </div>
                          <Textarea
                            value={summaryTexts[training.id] || ''}
                            onChange={(e) => setSummaryTexts((prev) => ({ ...prev, [training.id]: e.target.value }))}
                            rows={5}
                            className="bg-white border-diletto-gray/10 rounded-md focus:ring-diletto-blue/20"
                            placeholder="研修を終えて、学んだことや気づいたことを記入してください。"
                          />
                        </div>
                        <Button
                          onClick={() => onSubmit(training.id)}
                          disabled={submittingId === training.id || (summaryTexts[training.id] || '').length < TRAINING_SUMMARY_MIN_CHARS}
                          className="w-full h-12 bg-diletto-ink hover:bg-black text-white rounded-md shadow-md transition-all active:scale-[0.98]"
                        >
                          {submittingId === training.id ? '提出中...' : '研修完了を報告する'}
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* 研修は ViewConfirmButton を撤去 (提出だけを閲覧回数としてカウントする方針)。
                      他の 遵守事項/お知らせ/業務マニュアル は明示的な閲覧確認ボタンを残す。
                      過去の閲覧回数表示 (前回確認日時 + これまで N 回確認済み) はそのまま参考表示。 */}
                  {tenantId && employeeId && wasSubmittedAtOpen && (() => {
                    const s = viewSummaries.get(training.id);
                    if (!s || s.count === 0) return null;
                    const lastViewedLabel = s.lastAt
                      ? new Date(s.lastAt).toLocaleString('ja-JP', {
                          year: 'numeric', month: 'numeric', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : null;
                    return (
                      <div className="pt-3 border-t border-diletto-gray/10">
                        <p className="text-xs text-diletto-gray-light text-right">
                          これまで {s.count} 回 提出済み{lastViewedLabel ? `（最終 ${lastViewedLabel}）` : ''}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function MyTrainingsPage() {
  const [items, setItems] = useState<TrainingWithSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaryTexts, setSummaryTexts] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  /* 確認ボタンクリック数の集計 (item_id → ViewSummary)。 */
  const [viewSummaries, setViewSummaries] = useState<Map<string, ViewSummary>>(new Map());
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: me, error: meError } = await supabase
          .from('employees')
          .select('id, tenant_id, facility_id, position_id')
          .eq('auth_user_id', user.id)
          .single();

        if (meError || !me) {
          console.error('Error fetching employee:', meError);
          setLoading(false);
          return;
        }
        setTenantId(me.tenant_id);
        setEmployeeId(me.id);

        const { data: trainings } = await supabase
          .from('trainings')
          .select('*')
          .eq('tenant_id', me.tenant_id)
          .eq('is_published', true)
          .order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });

        const { data: subs } = await supabase
          .from('training_submissions')
          .select('*')
          .eq('employee_id', me.id);

        const subMap = new Map((subs || []).map((s) => [s.training_id, s as TrainingSubmission]));
        const texts: Record<string, string> = {};

        // 自分の所属 facility 集合（主所属 + 兼任先 / migration 130）
        const myFacilityIds = await fetchMyFacilityIds(supabase, me.id, me.facility_id);

        // フィルタリング（施設・役職） — migration 115 で部署フィルタ廃止
        // migration 130: 兼任先の facility 配信も届くように、target_facility_ids ∩ myFacilityIds で判定
        const scopedTrainings = (trainings || []).filter(t => {
          if (t.target_type === 'facility' && !facilityTargetsMatchMine(t.target_facility_ids, myFacilityIds)) return false;
          if (t.target_position_ids && t.target_position_ids.length > 0) {
            if (!t.target_position_ids.includes(me.position_id || '')) return false;
          }
          return true;
        }) as Training[];

        const result = scopedTrainings.map((t) => {
          const sub = subMap.get(t.id) || null;
          if (sub) texts[t.id] = sub.summary_text;
          return { training: t, submission: sub };
        });

        setItems(result);
        setSummaryTexts(texts);

        /* 自分の確認ボタン履歴を集計（モーダル内の「N 回目確認」表示用） */
        const summaries = await fetchMyViewSummary(supabase, 'training_view_logs', me.id);
        setViewSummaries(summaries);

        try {
          const catRes = await fetch('/api/categories?type=training');
          if (catRes.ok) setCategories(await catRes.json());
        } catch (e) {
          console.error('Error fetching categories:', e);
        }

        setLoading(false);
      } catch (e) {
        console.error('Unexpected error in MyTrainingsPage:', e);
        setLoading(false);
      }
    }
    load();
  }, [supabase]);

  async function handleSubmit(trainingId: string) {
    const text = summaryTexts[trainingId] || '';
    if (text.length < TRAINING_SUMMARY_MIN_CHARS) {
      toast.error(`感想は${TRAINING_SUMMARY_MIN_CHARS}文字以上必要です（現在${text.length}文字）`);
      return;
    }

    setSubmittingId(trainingId);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: me } = await supabase
      .from('employees')
      .select('id, tenant_id')
      .eq('auth_user_id', user.id)
      .single();

    if (!me) return;

    const { data, error } = await supabase
      .from('training_submissions')
      .insert({
        training_id: trainingId,
        employee_id: me.id,
        summary_text: text,
      })
      .select()
      .single();

    if (error) { toast.error('提出に失敗しました'); setSubmittingId(null); return; }

    setItems((prev) =>
      prev.map((i) => i.training.id === trainingId ? { ...i, submission: data as TrainingSubmission } : i)
    );

    /* 提出 = 1 回目の確認とカウント。view_logs にも 1 行追加。 */
    await logView(supabase, 'training_view_logs', { tenant_id: me.tenant_id, employee_id: me.id, item_id: trainingId });
    setViewSummaries((prev) => {
      const next = new Map(prev);
      const existing = next.get(trainingId);
      next.set(trainingId, { count: (existing?.count ?? 0) + 1, lastAt: new Date().toISOString() });
      return next;
    });

    toast.success('感想を提出しました');
    setSubmittingId(null);
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  const totalCount = items.length;
  const passedCount = items.filter((i) => i.submission?.result === 'passed').length;
  const unfinishedCount = totalCount - passedCount;
  const progressPercent = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  // カテゴリごとの統計
  const catStats = categories.map(cat => {
    const catItems = items.filter(i => i.training.category_id === cat.id);
    const unfinished = catItems.filter(i => !i.submission || i.submission.result === 'resubmit').length;
    return { ...cat, unfinished, total: catItems.length };
  });

  const uncategorizedItems = items.filter(i => !i.training.category_id);
  const uncategorizedUnfinished = uncategorizedItems.filter(i => !i.submission || i.submission.result === 'resubmit').length;

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-diletto-ink">研修</h1>
            <p className="text-sm text-diletto-gray mt-1">受講するカテゴリを選択してください</p>
          </div>
          {unfinishedCount > 0 && (
            <Badge className="bg-diletto-red text-white border-none shadow-sm flex gap-2 items-center h-8 px-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              未着手・再提出 {unfinishedCount}件
            </Badge>
          )}
        </div>

        {/* 進捗バー (my/dashboard を踏襲) */}
        <div className="mb-8 mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-diletto-gray">全体の合格状況 — {passedCount}/{totalCount} 合格</p>
            <p className="text-sm font-semibold text-diletto-ink">{progressPercent}%</p>
          </div>
          <div className="h-3 w-full rounded-full bg-diletto-beige overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${progressPercent === 100 ? 'bg-diletto-green' : 'bg-diletto-gold'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {catStats.map((cat) => {
            const catItems = items.filter(i => i.training.category_id === cat.id);
            const catTotal = catItems.length;
            const catDone = catItems.filter(i => i.submission?.result === 'passed').length;
            const catPct = catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0;

            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[160px] text-left"
              >
                <div
                  className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity"
                  style={{ backgroundColor: cat.color }}
                />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '📚'}
                  </span>
                  {cat.unfinished > 0 && (
                    <span className="h-5 min-w-5 px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                      {cat.unfinished}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <span className="text-sm font-bold text-diletto-ink block truncate mb-1">
                    {cat.name}
                  </span>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-diletto-gray">
                      {catDone}/{catTotal} 合格
                    </span>
                    {catPct === 100 && <Badge variant="success" className="text-[9px] py-0 h-4">完了</Badge>}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-diletto-beige overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${catPct === 100 ? 'bg-diletto-green' : 'bg-diletto-gold'}`}
                      style={{ width: `${catPct}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}

          {uncategorizedItems.length > 0 && (
            <button
              onClick={() => setSelectedCategory({ id: 'none', name: 'その他', icon: '📁', color: '#94a3b8' } as any)}
              className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[160px] text-left"
            >
              <div className="flex justify-between items-start mb-auto relative">
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300">📁</span>
                {uncategorizedUnfinished > 0 && (
                  <span className="h-5 min-w-5 px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                    {uncategorizedUnfinished}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="text-sm font-bold text-diletto-ink block mb-1">その他</span>
                <span className="text-[10px] text-diletto-gray block mb-2">{uncategorizedItems.length} 項目</span>
                <div className="h-1.5 w-full rounded-full bg-diletto-beige overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-diletto-gray-light/30`}
                    style={{ width: `${Math.round(((uncategorizedItems.length - uncategorizedUnfinished) / uncategorizedItems.length) * 100)}%` }}
                  />
                </div>
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  const visibleItems = selectedCategory.id === 'none'
    ? uncategorizedItems
    : items.filter(i => i.training.category_id === selectedCategory.id);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedCategory(null)}
          className="text-diletto-gray-light hover:text-diletto-ink"
        >
          ← カテゴリ一覧へ
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xl">{selectedCategory.icon}</span>
          <h1 className="text-2xl font-bold">{selectedCategory.name}</h1>
        </div>
      </div>

      <TrainingsGrid
        items={visibleItems}
        summaryTexts={summaryTexts}
        setSummaryTexts={setSummaryTexts}
        submittingId={submittingId}
        onSubmit={handleSubmit}
        tenantId={tenantId}
        employeeId={employeeId}
        viewSummaries={viewSummaries}
      />
    </div>
  );
}
