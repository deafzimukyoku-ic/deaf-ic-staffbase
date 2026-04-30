'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { EmployeeImagesCard } from '@/components/employee/EmployeeImagesCard';
import type { DocumentTemplate, DocumentSubmission } from '@/lib/types';

interface TemplateWithSubmission {
  template: DocumentTemplate;
  submission: DocumentSubmission | null;
}

export default function MyDocumentsPage() {
  const [items, setItems] = useState<TemplateWithSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [employeeData, setEmployeeData] = useState<{ license_image_path: string | null; commute_route_image_path: string | null; custom_fields: Record<string, string> | null } | null>(null);
  const [imageFieldDefs, setImageFieldDefs] = useState<{ field_key: string; label: string; field_type: string }[]>([]);
  /* 基本情報の最終更新時刻。document_submissions.submitted_at と比較して
     「提出後に基本情報が変わった」場合に再提出ボタンを強調表示するため。 */
  const [employeeUpdatedAt, setEmployeeUpdatedAt] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: me, error: meError } = await supabase
          .from('employees')
          .select('*')  /* migration 119 自動判定で employee の各 boolean フラグを参照するため全列取得 */
          .eq('auth_user_id', user.id)
          .single();

        if (meError || !me) {
          console.error('Error fetching employee:', meError);
          setLoading(false);
          return;
        }
        setEmployeeId(me.id);
        setTenantId(me.tenant_id);
        setEmployeeUpdatedAt((me.updated_at as string) ?? null);
        setEmployeeData({
          license_image_path: me.license_image_path,
          commute_route_image_path: me.commute_route_image_path,
          /* 旧バグ: ここで null をハードコードしていたためアップロード後にページ再読み込みすると
             カスタム画像が「未アップロード」表示に戻っていた。DB の値をそのまま反映する。 */
          custom_fields: (me.custom_fields ?? null) as Record<string, string> | null,
        });

        // 画像タイプのカスタムフィールド定義
        const { data: imgDefs, error: imgError } = await supabase
          .from('custom_employee_fields')
          .select('field_key, label, field_type')
          .eq('tenant_id', me.tenant_id)
          .eq('field_type', 'image')
          .eq('is_active', true);
        if (imgError) console.error('Error fetching image fields:', imgError);
        if (imgDefs) setImageFieldDefs(imgDefs);

        const { data: templates, error: tempError } = await supabase
          .from('document_templates')
          .select('*')
          .eq('tenant_id', me.tenant_id)
          .order('display_order');

        if (tempError || !templates) {
          console.error('Error fetching templates:', tempError);
          setLoading(false);
          return;
        }

        /* migration 122: 書類テンプレ自身の配布対象ルールで判定。
           ルール 0 件 = 全員対象。ルール 1 件以上 = いずれかに該当（OR）。 */
        const { isEmployeeInAudience, loadTemplateAudience } = await import('@/lib/template-audience');
        const tplIds = (templates as DocumentTemplate[]).map((t) => t.id);
        const audienceByTemplate = await loadTemplateAudience(supabase, tplIds);

        const filtered = (templates as DocumentTemplate[]).filter((t) => {
          if (t.template_type === 'pdf' && t.data_mode === 'matrix') return false;
          return isEmployeeInAudience(t.id, me as unknown as import('@/lib/types').Employee, audienceByTemplate);
        });

        const { data: submissions } = await supabase
          .from('document_submissions')
          .select('*')
          .eq('employee_id', me.id);

        const subMap = new Map((submissions || []).map((s) => [s.document_template_id, s as DocumentSubmission]));

        setItems(filtered.map((t) => ({
          template: t,
          submission: subMap.get(t.id) || null,
        })));

        setLoading(false);
      } catch (e) {
        console.error('Unexpected error in MyDocumentsPage:', e);
        setLoading(false);
      }
    }
    load();
  }, [supabase]);

  async function handlePreview(templateId: string) {
    if (previewId === templateId) {
      // トグル：閉じる
      setPreviewId(null);
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
      return;
    }

    if (!employeeId) return;
    setPreviewId(templateId);
    setPreviewLoading(true);
    setPreviewUrl(null);

    try {
      const res = await fetch('/api/documents/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, template_id: templateId, form_data: {} }),
      });

      if (!res.ok) throw new Error('PDF生成に失敗しました');

      const blob = await res.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'プレビューの読み込みに失敗しました');
      setPreviewId(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirm(templateId: string) {
    setActionId(templateId);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: me } = await supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!me) return;

    const item = items.find((i) => i.template.id === templateId);
    if (!item) return;

    if (item.submission) {
      await supabase
        .from('document_submissions')
        .update({ status: 'submitted', submitted_at: new Date().toISOString() })
        .eq('id', item.submission.id);
    } else {
      await supabase
        .from('document_submissions')
        .insert({
          employee_id: me.id,
          document_template_id: templateId,
          form_data: {},
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        });
    }

    setItems((prev) =>
      prev.map((i) =>
        i.template.id === templateId
          ? { ...i, submission: { ...(i.submission || {} as DocumentSubmission), status: 'submitted' as const, submitted_at: new Date().toISOString() } as DocumentSubmission }
          : i
      )
    );

    toast.success('確認しました');
    setActionId(null);
  }

  async function handleDownloadPdf(templateId: string, templateName: string) {
    if (!employeeId) return;
    setActionId(templateId);
    try {
      const res = await fetch('/api/documents/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, template_id: templateId, form_data: {} }),
      });

      if (!res.ok) throw new Error('PDF生成に失敗しました');

      const blob = await res.blob();
      const fileName = res.headers.get('X-Filename') || `${templateName}.pdf`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF生成に失敗しました');
    } finally {
      setActionId(null);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">書類</h1>

      {employeeData && employeeId && tenantId && (
        <div className="mb-6">
          <EmployeeImagesCard
            employeeId={employeeId}
            tenantId={tenantId}
            licensePath={employeeData.license_image_path}
            commuteRoutePath={employeeData.commute_route_image_path}
            customFields={employeeData.custom_fields}
            customFieldDefs={imageFieldDefs}
            editable
            hideDriverFixedImages
            onImageUpdated={(fieldKey, path) => {
              setEmployeeData((prev) => {
                if (!prev) return prev;
                if (fieldKey === 'license_image_path') return { ...prev, license_image_path: path };
                if (fieldKey === 'commute_route_image_path') return { ...prev, commute_route_image_path: path };
                return { ...prev, custom_fields: { ...(prev.custom_fields || {}), [fieldKey]: path } };
              });
            }}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-diletto-gray-light">提出対象の書類がありません</p>
      ) : (
        <div className="space-y-4">
          {items.map(({ template, submission }) => {
            const isConfirmed = submission?.status === 'submitted';
            const isPreviewOpen = previewId === template.id;
            /* 提出後に基本情報が更新されていれば「再提出」ボタンを強調表示する。
               employees.updated_at > document_submissions.submitted_at で判定。 */
            const needsResubmit = isConfirmed && submission?.submitted_at && employeeUpdatedAt
              ? new Date(employeeUpdatedAt) > new Date(submission.submitted_at)
              : false;

            return (
              <Card key={template.id} className={isConfirmed && !needsResubmit ? 'opacity-70' : ''}>
                <CardContent className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span className="text-lg shrink-0">📄</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm break-words">{template.name}</p>
                        <p className="text-xs text-diletto-gray">
                          {template.template_type === 'pdf' ? 'PDF' : 'DOCX'}
                          {isConfirmed && submission?.submitted_at && (
                            <> · 確認日: {new Date(submission.submitted_at).toLocaleDateString('ja-JP')}</>
                          )}
                        </p>
                        {needsResubmit && (
                          <p className="text-xs text-diletto-red mt-1 font-semibold">
                            ⚠ 提出後に基本情報が更新されました。最新内容で再提出してください。
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2 shrink-0">
                      {/* 提出済バッジ（変化なし時は淡く、再提出が必要なら警告色） */}
                      {isConfirmed && !needsResubmit && (
                        <Badge className="bg-diletto-green/10 text-diletto-green border-diletto-green/20">確認済</Badge>
                      )}
                      {/* 提出 / 再提出ボタン: いつでも押せる仕様。
                          状態によってラベル・色を変える */}
                      <Button
                        size="sm"
                        variant={needsResubmit ? 'default' : isConfirmed ? 'outline' : 'default'}
                        className={needsResubmit ? 'bg-diletto-red hover:bg-diletto-red/90' : ''}
                        onClick={() => handleConfirm(template.id)}
                        disabled={actionId === template.id}
                      >
                        {actionId === template.id
                          ? '処理中...'
                          : needsResubmit
                          ? '再提出する'
                          : isConfirmed
                          ? '再提出'
                          : '内容を確認しました'}
                      </Button>

                      {template.template_type === 'pdf' && (
                        <>
                          <Button
                            size="sm"
                            variant={isPreviewOpen ? 'default' : 'outline'}
                            onClick={() => handlePreview(template.id)}
                          >
                            {isPreviewOpen ? '閉じる' : 'プレビュー'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownloadPdf(template.id, template.name)}
                            disabled={actionId === template.id}
                          >
                            DL
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* PDFプレビュー */}
                  {isPreviewOpen && (
                    <div className="mt-4 border-t border-diletto-gray/10 pt-4">
                      {previewLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" />
                          <span className="ml-3 text-sm text-diletto-gray">PDF生成中...</span>
                        </div>
                      ) : previewUrl ? (
                        <iframe
                          src={previewUrl}
                          className="w-full rounded-md border"
                          style={{ height: '70vh' }}
                          title={`${template.name} プレビュー`}
                        />
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

    </div>
  );
}
