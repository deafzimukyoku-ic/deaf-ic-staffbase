'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MAX_DOCUMENTS_PER_TENANT } from '@/lib/constants';
import { DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { DocumentTemplate, Employee, Facility } from '@/lib/types';
import { loadTemplateAudience, saveTemplateAudience, summarizeAudience, FLAG_OPTIONS, type AudienceRule } from '@/lib/template-audience';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function DocumentsPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [samples, setSamples] = useState<DocumentTemplate[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplate | null>(null);
  const [deleteSubCount, setDeleteSubCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  /* template_id → 配置済みタグ数。エディタで PDF 上に配置済み（pdf_tag_placements）の数を出す。
     未配置のタグ（pdf_tags のみあって placements に無い）はカウントしない
     — 「マッピング済み」= 実際に PDF 上に出る数、というユーザー期待に揃える。 */
  const [placementCounts, setPlacementCounts] = useState<Record<string, number>>({});
  /* 配布対象ルールと対象人数表示用のマスタ */
  const [audienceByTemplate, setAudienceByTemplate] = useState<Map<string, AudienceRule[]>>(new Map());
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const supabase = createClient();

  async function loadTemplates() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: me } = await supabase
      .from('employees')
      .select('tenant_id')
      .eq('auth_user_id', user.id)
      .single();

    if (!me) return;
    setTenantId(me.tenant_id);

    /* 全社員 + 全施設をプレビュー用に事前ロード */
    const [empRes, facRes] = await Promise.all([
      supabase.from('employees').select('*').eq('tenant_id', me.tenant_id).eq('status', 'active'),
      supabase.from('facilities').select('id, tenant_id, name, address, created_at, display_order').eq('tenant_id', me.tenant_id).order('display_order'),
    ]);
    setAllEmployees((empRes.data || []) as Employee[]);
    setAllFacilities((facRes.data || []) as Facility[]);

    const [myTemplates, sampleTemplates] = await Promise.all([
      supabase.from('document_templates').select('*').eq('tenant_id', me.tenant_id).order('display_order'),
      supabase.from('document_templates').select('*').is('tenant_id', null).eq('is_sample', true).order('display_order'),
    ]);

    const myList = (myTemplates.data as DocumentTemplate[]) || [];
    setTemplates(myList);
    setSamples((sampleTemplates.data as DocumentTemplate[]) || []);

    /* placements 数 + 配布対象ルールの一括ロード */
    if (myList.length > 0) {
      const ids = myList.map((t) => t.id);
      const [plsRes, audience] = await Promise.all([
        supabase.from('pdf_tag_placements').select('template_id').in('template_id', ids),
        loadTemplateAudience(supabase, ids),
      ]);
      const counts: Record<string, number> = {};
      for (const p of (plsRes.data || []) as { template_id: string }[]) {
        counts[p.template_id] = (counts[p.template_id] || 0) + 1;
      }
      setPlacementCounts(counts);
      setAudienceByTemplate(audience);
    } else {
      setPlacementCounts({});
      setAudienceByTemplate(new Map());
    }
    setLoading(false);
  }

  /* 配布対象ルールの保存（モーダル「保存」時） */
  async function commitAudience(templateId: string, rules: AudienceRule[]) {
    const { error } = await saveTemplateAudience(supabase, templateId, rules);
    if (error) {
      toast.error('配布対象の保存に失敗しました', { description: error.message });
      return false;
    }
    /* ローカルの state も更新 */
    const next = new Map(audienceByTemplate);
    if (rules.length === 0) next.delete(templateId);
    else next.set(templateId, rules);
    setAudienceByTemplate(next);
    toast.success('配布対象を更新しました');
    return true;
  }

  /* 174: 会社発行用フラグ + デフォルトコメントの保存 */
  async function commitCompanyIssue(
    templateId: string,
    payload: { is_company_issued: boolean; auto_issue_message: string | null }
  ) {
    const { error } = await supabase
      .from('document_templates')
      .update(payload)
      .eq('id', templateId);
    if (error) {
      toast.error('保存に失敗しました', { description: error.message });
      return false;
    }
    setTemplates((prev) =>
      prev.map((t) => (t.id === templateId ? { ...t, ...payload } : t))
    );
    toast.success('会社発行設定を更新しました');
    return true;
  }

  useEffect(() => { loadTemplates(); }, []);

  async function handleAddSample(sample: DocumentTemplate) {
    if (!tenantId) return;
    setAdding(sample.id);

    // テンプレートをコピー（PDF関連カラム含む）
    const { data: inserted, error } = await supabase.from('document_templates').insert({
      tenant_id: tenantId,
      name: sample.name,
      template_type: sample.template_type,
      pdf_storage_path: sample.pdf_storage_path,
      page_count: sample.page_count,
      docx_storage_path: sample.docx_storage_path,
      mapping: sample.mapping,
      is_sample: false,
      display_order: templates.length + 1,
    }).select('id').single();

    if (error || !inserted) {
      toast.error('追加に失敗しました', { description: error?.message });
      setAdding(null);
      return;
    }

    // PDFテンプレートの場合、タグと配置もコピー
    if (sample.template_type === 'pdf') {
      const newTemplateId = inserted.id;

      // タグを取得
      const { data: srcTags } = await supabase
        .from('pdf_tags')
        .select('*')
        .eq('template_id', sample.id);

      if (srcTags && srcTags.length > 0) {
        // タグをコピー（新IDを生成）
        const tagIdMap = new Map<string, string>();
        const newTags = srcTags.map((t) => {
          const newId = crypto.randomUUID();
          tagIdMap.set(t.id, newId);
          return {
            id: newId,
            template_id: newTemplateId,
            column_key: t.column_key,
            display_name: t.display_name,
          };
        });

        await supabase.from('pdf_tags').insert(newTags);

        // 配置を取得してコピー
        const { data: srcPlacements } = await supabase
          .from('pdf_tag_placements')
          .select('*')
          .eq('template_id', sample.id);

        if (srcPlacements && srcPlacements.length > 0) {
          const newPlacements = srcPlacements.map((p) => ({
            template_id: newTemplateId,
            tag_id: tagIdMap.get(p.tag_id) || p.tag_id,
            page_number: p.page_number,
            x: p.x,
            y: p.y,
            font_size: p.font_size,
          }));

          await supabase.from('pdf_tag_placements').insert(newPlacements);
        }
      }
    }

    toast.success(`「${sample.name}」を追加しました`);
    await loadTemplates();
    setAdding(null);
  }

  async function openDeleteDialog(template: DocumentTemplate) {
    const { count } = await supabase
      .from('document_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('document_template_id', template.id);

    setDeleteSubCount(count || 0);
    setDeleteTarget(template);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    // 1. 関連する提出データを先に削除（FK制約にCASCADEなし）
    if (deleteSubCount > 0) {
      const { error: subErr } = await supabase
        .from('document_submissions')
        .delete()
        .eq('document_template_id', deleteTarget.id);

      if (subErr) {
        toast.error('提出データの削除に失敗しました', { description: subErr.message });
        setDeleting(false);
        return;
      }
    }

    // 2. テンプレートレコードを削除
    const { error: tplErr } = await supabase
      .from('document_templates')
      .delete()
      .eq('id', deleteTarget.id);

    if (tplErr) {
      toast.error('テンプレートの削除に失敗しました', { description: tplErr.message });
      setDeleting(false);
      return;
    }

    // 3. Storageのファイルを削除（失敗しても続行）
    const storagePath = deleteTarget.pdf_storage_path || deleteTarget.docx_storage_path;
    if (storagePath) {
      await supabase.storage
        .from('documents')
        .remove([storagePath]);
    }

    toast.success(`「${deleteTarget.name}」を削除しました`);
    setDeleteTarget(null);
    setDeleting(false);
    await loadTemplates();
  }

  // 既にテナントに追加済みのサンプル名を除外
  const availableSamples = samples.filter(
    (s) => !templates.some((t) => t.name === s.name)
  );

  /* ドラッグ並び替え。display_order を 0..N-1 で振り直して並列 UPDATE。
     失敗時は loadTemplates() でサーバ状態に巻き戻す。
     社員側 (/my/documents) も .order('display_order') で取得しているので即反映される。 */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = templates.findIndex((t) => t.id === active.id);
    const newIndex = templates.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(templates, oldIndex, newIndex);
    setTemplates(reordered); // 楽観更新

    const results = await Promise.all(
      reordered.map((t, idx) =>
        supabase.from('document_templates').update({ display_order: idx }).eq('id', t.id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error('並び替えの保存に失敗しました', { description: failed.error.message });
      await loadTemplates();
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold whitespace-nowrap">書類テンプレート</h1>
          <p className="text-sm text-brand-gray mt-1 whitespace-nowrap">
            {loading ? '読み込み中...' : `${templates.length} / ${MAX_DOCUMENTS_PER_TENANT} 件`}
          </p>
        </div>
        {templates.length < MAX_DOCUMENTS_PER_TENANT && (
          <div className="flex flex-wrap items-center gap-2">
            <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
              <DialogTrigger className="inline-flex shrink-0 items-center justify-center rounded-md border border-brand-gray/30 bg-white text-brand-ink shadow-sm hover:border-brand-ink/60 text-sm font-medium h-10 px-4 whitespace-nowrap transition-all duration-300">
                📋 カタログから追加
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>テンプレートカタログ</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-brand-gray mb-4">
                  用意されたテンプレートから選んで追加できます。
                </p>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {availableSamples.length === 0 ? (
                    <p className="text-sm text-brand-gray-light text-center py-6">
                      追加できるテンプレートはありません
                    </p>
                  ) : (
                    availableSamples.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-md border border-brand-gray/10 p-3">
                        <div>
                          <p className="text-sm font-medium">{s.name}</p>
                          <p className="text-xs text-brand-gray">
                            {s.template_type === 'pdf' ? `${s.page_count || 1}ページ` : `${(s.mapping as unknown[]).length} フィールド`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={adding === s.id || templates.length >= MAX_DOCUMENTS_PER_TENANT}
                          onClick={() => handleAddSample(s)}
                        >
                          {adding === s.id ? '追加中...' : '+ 追加'}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Link href="/admin/documents/new-pdf">
              <Button className="whitespace-nowrap">📑 PDFアップロード</Button>
            </Link>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={templates.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {templates.map((t) => {
              const summary = summarizeAudience(t.id, audienceByTemplate, allEmployees);
              return (
                <SortableTemplateCard
                  key={t.id}
                  template={t}
                  placementCount={placementCounts[t.id] ?? 0}
                  audienceSummary={summary}
                  initialRules={audienceByTemplate.get(t.id) || []}
                  allEmployees={allEmployees}
                  allFacilities={allFacilities}
                  onCommitAudience={(rules) => commitAudience(t.id, rules)}
                  onCommitCompanyIssue={(payload) => commitCompanyIssue(t.id, payload)}
                  onDelete={openDeleteDialog}
                />
              );
            })}
          </SortableContext>
        </DndContext>

        {!loading && templates.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-brand-gray-light">
              書類テンプレートがありません。「+ テンプレート追加」から登録してください。
            </CardContent>
          </Card>
        )}
      </div>
      {/* 削除確認ダイアログ */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>テンプレートの削除</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-brand-gray">
              「<span className="font-medium text-brand-ink">{deleteTarget?.name}</span>」を削除します。
            </p>
            {deleteSubCount > 0 && (
              <div className="rounded-md border border-brand-red/20 bg-brand-red/[0.04] p-3">
                <p className="text-sm text-brand-red font-medium">
                  この書類には {deleteSubCount} 件の提出データがあります。
                </p>
                <p className="text-xs text-brand-red/80 mt-1">
                  削除すると社員の提出データも全て失われます。この操作は取り消せません。
                </p>
              </div>
            )}
            {deleteSubCount === 0 && (
              <p className="text-xs text-brand-gray-light">提出データはありません。</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              キャンセル
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-brand-red hover:bg-[#7a2828] text-white"
            >
              {deleting ? '削除中...' : '削除する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ドラッグ可能なテンプレートカード。
   左端にドラッグハンドル（⋮⋮）を出し、ハンドル領域だけドラッグ反応するようにする
   （カード本体のクリックで誤ってドラッグが始まらないように listeners をハンドル限定）。 */
function SortableTemplateCard({
  template: t,
  placementCount,
  audienceSummary,
  initialRules,
  allEmployees,
  allFacilities,
  onCommitAudience,
  onCommitCompanyIssue,
  onDelete,
}: {
  template: DocumentTemplate;
  placementCount: number;
  audienceSummary: { kind: 'all' | 'rules'; count: number; label: string };
  initialRules: AudienceRule[];
  allEmployees: Employee[];
  allFacilities: Facility[];
  onCommitAudience: (rules: AudienceRule[]) => Promise<boolean>;
  /* 174: 会社発行用フラグ + デフォルトコメント保存 */
  onCommitCompanyIssue: (payload: { is_company_issued: boolean; auto_issue_message: string | null }) => Promise<boolean>;
  onDelete: (t: DocumentTemplate) => void;
}) {
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [companyIssueOpen, setCompanyIssueOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <button
              type="button"
              className="text-brand-gray-light hover:text-brand-ink cursor-grab active:cursor-grabbing touch-none px-1 shrink-0 mt-0.5"
              aria-label="並び替え"
              {...attributes}
              {...listeners}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{t.name}</p>
              <div className="flex gap-2 mt-1 items-center flex-wrap">
                <Badge variant="default" className="text-xs">PDF</Badge>
                {t.page_count && (
                  <span className="text-xs text-brand-gray-light whitespace-nowrap">{t.page_count}ページ</span>
                )}
                {/* マッピング件数 — 0 件は薄くして「未配置」と分かるように */}
                <span
                  className={`text-xs whitespace-nowrap ${placementCount === 0 ? 'text-brand-red/70' : 'text-brand-gray-light'}`}
                >
                  {placementCount === 0 ? 'マッピング未設定' : `マッピング ${placementCount} 件`}
                </span>
                {/* 配布対象バッジ: 「対象: 全員 (15名)」または「対象: 条件で絞る (7名)」 */}
                <button
                  type="button"
                  onClick={() => setAudienceOpen(true)}
                  className={`inline-flex items-center gap-1 text-xs whitespace-nowrap rounded-md px-2 py-0.5 border transition-colors ${
                    audienceSummary.kind === 'rules'
                      ? 'border-brand-blue/40 bg-brand-blue/[0.06] text-brand-blue hover:bg-brand-blue/[0.1]'
                      : 'border-brand-gray/30 text-brand-gray hover:bg-brand-gray/5'
                  }`}
                  title="配布対象を編集"
                >
                  <span>対象: {audienceSummary.label} ({audienceSummary.count}名)</span>
                  <span className="text-[10px] opacity-60">✎</span>
                </button>
                {/* 174: 会社発行用バッジ。ON なら緑、OFF は淡灰。クリックで CompanyIssueDialog */}
                <button
                  type="button"
                  onClick={() => setCompanyIssueOpen(true)}
                  className={`inline-flex items-center gap-1 text-xs whitespace-nowrap rounded-md px-2 py-0.5 border transition-colors ${
                    t.is_company_issued
                      ? 'border-emerald-400/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-brand-gray/30 text-brand-gray-light hover:bg-brand-gray/5'
                  }`}
                  title="会社発行 (招待時自動発行 + 一括発行) の設定"
                >
                  <span>{t.is_company_issued ? '📨 会社発行用' : '会社発行: OFF'}</span>
                  <span className="text-[10px] opacity-60">✎</span>
                </button>
              </div>
            </div>
          </div>

          <CompanyIssueDialog
            open={companyIssueOpen}
            onOpenChange={setCompanyIssueOpen}
            templateName={t.name}
            initialEnabled={t.is_company_issued}
            initialMessage={t.auto_issue_message ?? ''}
            placementCount={placementCount}
            onCommit={onCommitCompanyIssue}
          />

          <AudienceDialog
            open={audienceOpen}
            onOpenChange={setAudienceOpen}
            templateName={t.name}
            initialRules={initialRules}
            allEmployees={allEmployees}
            allFacilities={allFacilities}
            onCommit={onCommitAudience}
          />

          <div className="flex items-center flex-wrap gap-2 shrink-0">
            {t.pdf_storage_path && (
              <>
                <Link href={`/admin/documents/${t.id}/editor`}>
                  <Button variant="outline" size="sm">エディタ</Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const res = await fetch('/api/documents/bulk-pdf-zip-employee', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ template_id: t.id }),
                    });
                    if (!res.ok) {
                      const json = await res.json();
                      toast.error(json.error || '一括出力に失敗しました');
                      return;
                    }
                    const blob = await res.blob();
                    const fileName = res.headers.get('X-Filename') || 'output.zip';
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = fileName;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                >
                  一括PDF出力
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-brand-red border-brand-red/30 hover:bg-brand-red/5"
              onClick={() => onDelete(t)}
            >
              削除
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ==========================================================================
   配布対象設定ダイアログ
   - モード: 全員 / 条件で絞る の 2 択ラジオ
   - 「条件で絞る」時: フラグ・施設・役職・個別指名の 4 系統を選択可（複数チェックは OR）
   - 保存前に対象社員のプレビューを表示
   ========================================================================== */
function AudienceDialog({
  open, onOpenChange, templateName, initialRules, allEmployees, allFacilities, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  initialRules: AudienceRule[];
  allEmployees: Employee[];
  allFacilities: Facility[];
  onCommit: (rules: AudienceRule[]) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'all' | 'rules'>(initialRules.length === 0 ? 'all' : 'rules');
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [facilities, setFacilities] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [employees, setEmployees] = useState<Set<string>>(new Set());
  const [empSearch, setEmpSearch] = useState('');
  const [saving, setSaving] = useState(false);

  /* open/initialRules が変わるたびに state を初期化（ダイアログ開閉のたびに最新化） */
  useEffect(() => {
    if (!open) return;
    setMode(initialRules.length === 0 ? 'all' : 'rules');
    setFlags(new Set(initialRules.filter(r => r.rule_type === 'flag').map(r => r.rule_value)));
    setFacilities(new Set(initialRules.filter(r => r.rule_type === 'facility').map(r => r.rule_value)));
    setRoles(new Set(initialRules.filter(r => r.rule_type === 'role').map(r => r.rule_value)));
    setEmployees(new Set(initialRules.filter(r => r.rule_type === 'employee').map(r => r.rule_value)));
    setEmpSearch('');
  }, [open, initialRules]);

  function toggleSet(set: Set<string>, setter: (s: Set<string>) => void, val: string) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setter(next);
  }

  /* 現在の選択状態から AudienceRule[] を構築 */
  const draftRules: AudienceRule[] = mode === 'all' ? [] : [
    ...Array.from(flags).map((v): AudienceRule => ({ rule_type: 'flag', rule_value: v })),
    ...Array.from(facilities).map((v): AudienceRule => ({ rule_type: 'facility', rule_value: v })),
    ...Array.from(roles).map((v): AudienceRule => ({ rule_type: 'role', rule_value: v })),
    ...Array.from(employees).map((v): AudienceRule => ({ rule_type: 'employee', rule_value: v })),
  ];

  /* プレビュー: 現在の選択で対象になる社員を抽出 */
  const previewMatches = mode === 'all'
    ? allEmployees
    : allEmployees.filter((e) => draftRules.some((r) => {
        if (r.rule_type === 'flag') return (e as unknown as Record<string, unknown>)[r.rule_value] === true;
        if (r.rule_type === 'facility') return e.facility_id === r.rule_value;
        if (r.rule_type === 'role') return e.role === r.rule_value;
        if (r.rule_type === 'employee') return e.id === r.rule_value;
        return false;
      }));

  const filteredEmployeesForPicker = allEmployees.filter((e) => {
    if (!empSearch.trim()) return true;
    const q = empSearch.trim().toLowerCase();
    const hay = `${e.last_name}${e.first_name}${e.last_name_kana || ''}${e.first_name_kana || ''}${e.email || ''}`.toLowerCase();
    return hay.includes(q);
  });

  async function handleSave() {
    setSaving(true);
    const ok = await onCommit(draftRules);
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>「{templateName}」を提出するのは…</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          {/* モード選択 */}
          <div className="space-y-2">
            <label className="flex items-start gap-3 rounded-md border border-brand-gray/15 p-3 cursor-pointer hover:bg-brand-beige/30 transition-colors">
              <input
                type="radio"
                className="mt-0.5 h-4 w-4 accent-brand-blue"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">全員 ({allEmployees.length}名)</p>
                <p className="text-[11px] text-brand-gray-light mt-0.5">在籍中の社員全員に配布。新人が追加されても自動で対象に含まれます。</p>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-brand-gray/15 p-3 cursor-pointer hover:bg-brand-beige/30 transition-colors">
              <input
                type="radio"
                className="mt-0.5 h-4 w-4 accent-brand-blue"
                checked={mode === 'rules'}
                onChange={() => setMode('rules')}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">条件で絞る</p>
                <p className="text-[11px] text-brand-gray-light mt-0.5">下のチェックリストから条件を選択。複数選択はいずれかに該当（OR）。</p>
              </div>
            </label>
          </div>

          {/* 条件チェックリスト */}
          {mode === 'rules' && (
            <div className="space-y-3 pl-2 border-l-2 border-brand-blue/20 ml-2">
              {/* フラグ */}
              <div>
                <p className="text-xs font-bold text-brand-gray mb-2">社員フラグ</p>
                <div className="space-y-1.5">
                  {FLAG_OPTIONS.map((f) => (
                    <label key={f.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-blue"
                        checked={flags.has(f.value)}
                        onChange={() => toggleSet(flags, setFlags, f.value)}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 施設 */}
              {allFacilities.length > 0 && (
                <div className="pt-2 border-t border-brand-gray/10">
                  <p className="text-xs font-bold text-brand-gray mb-2">特定の事業所</p>
                  <div className="space-y-1.5">
                    {allFacilities.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-blue"
                          checked={facilities.has(f.id)}
                          onChange={() => toggleSet(facilities, setFacilities, f.id)}
                        />
                        <span>{f.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 役職 */}
              <div className="pt-2 border-t border-brand-gray/10">
                <p className="text-xs font-bold text-brand-gray mb-2">特定の役職</p>
                <div className="space-y-1.5">
                  {[
                    { value: 'admin', label: '管理者' },
                    { value: 'manager', label: 'マネージャー' },
                    { value: 'employee', label: '一般社員' },
                  ].map((r) => (
                    <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-blue"
                        checked={roles.has(r.value)}
                        onChange={() => toggleSet(roles, setRoles, r.value)}
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 個別指名 */}
              <div className="pt-2 border-t border-brand-gray/10">
                <p className="text-xs font-bold text-brand-gray mb-2">個別指名 ({employees.size}名選択中)</p>
                <input
                  type="text"
                  placeholder="氏名・カナ・メールで検索"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  className="w-full h-8 rounded-md border border-brand-gray/20 bg-white px-2 text-sm mb-2"
                />
                <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border border-brand-gray/10 p-2">
                  {filteredEmployeesForPicker.length === 0 ? (
                    <p className="text-xs text-brand-gray-light py-2 text-center">該当する社員がいません</p>
                  ) : filteredEmployeesForPicker.map((e) => (
                    <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-brand-beige/30 px-1 py-0.5 rounded">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-blue"
                        checked={employees.has(e.id)}
                        onChange={() => toggleSet(employees, setEmployees, e.id)}
                      />
                      <span>{e.last_name} {e.first_name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-brand-gray-light mt-1">
                  ※ 個別指名は「ピンポイント追加」用。新人が来ても自動では追加されません。
                </p>
              </div>
            </div>
          )}

          {/* プレビュー */}
          <div className="rounded-md border border-brand-blue/20 bg-brand-blue/[0.04] p-3">
            <p className="text-xs font-bold text-brand-blue mb-1.5">📋 この設定で {previewMatches.length} 名が対象</p>
            {previewMatches.length === 0 ? (
              <p className="text-[11px] text-brand-gray-light">該当する社員がいません</p>
            ) : (
              <p className="text-[11px] text-brand-gray break-words">
                {previewMatches.slice(0, 8).map((e) => `${e.last_name} ${e.first_name}`).join(' / ')}
                {previewMatches.length > 8 && ` ほか ${previewMatches.length - 8} 名`}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* 174: 会社発行用フラグ + デフォルトコメントを編集するダイアログ */
function CompanyIssueDialog({
  open,
  onOpenChange,
  templateName,
  initialEnabled,
  initialMessage,
  placementCount,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  initialEnabled: boolean;
  initialMessage: string;
  placementCount: number;
  onCommit: (payload: { is_company_issued: boolean; auto_issue_message: string | null }) => Promise<boolean>;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState(initialMessage);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEnabled(initialEnabled);
      setMessage(initialMessage);
    }
  }, [open, initialEnabled, initialMessage]);

  const placementMissing = placementCount === 0;

  async function handleSave() {
    setSaving(true);
    const ok = await onCommit({
      is_company_issued: enabled,
      auto_issue_message: message.trim() || null,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>会社発行の設定</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            「{templateName}」を、新規招待時に自動配布 / 既存社員に一括配布する対象にします。
          </p>
        </DialogHeader>

        {placementMissing && (
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs px-3 py-2">
            ⚠ このテンプレートはタグ配置が未設定のため、ON にしても発行できません。先にエディタで配置してください。
          </div>
        )}

        <div className="space-y-3 py-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={placementMissing}
            />
            <span>会社発行用にする (招待時自動発行 + 一括発行の対象)</span>
          </label>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              デフォルト発行コメント (任意)
            </label>
            <Textarea
              rows={3}
              placeholder="例: ご入社ありがとうございます。ご確認ください。"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              招待時・一括発行時に発行コメントとして自動付与されます (空欄ならコメント無し)。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
