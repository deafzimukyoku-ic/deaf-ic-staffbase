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
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: me, error: meError } = await supabase
          .from('employees')
          .select('id, tenant_id, has_car_commute, is_shuttle_driver, license_image_path, commute_route_image_path')
          .eq('auth_user_id', user.id)
          .single();

        if (meError || !me) {
          console.error('Error fetching employee:', meError);
          setLoading(false);
          return;
        }
        setEmployeeId(me.id);
        setTenantId(me.tenant_id);
        setEmployeeData({
          license_image_path: me.license_image_path,
          commute_route_image_path: me.commute_route_image_path,
          custom_fields: null,
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

        const filtered = (templates as DocumentTemplate[]).filter((t) => {
          if (t.template_type === 'pdf' && t.data_mode === 'matrix') return false;
          if (t.visibility_condition === 'all') return true;
          if (t.visibility_condition === 'car_commute_only') return me.has_car_commute;
          if (t.visibility_condition === 'shuttle_driver_only') return me.is_shuttle_driver;
          return true;
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

            return (
              <Card key={template.id} className={isConfirmed ? 'opacity-70' : ''}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">📄</span>
                      <div>
                        <p className="font-medium text-sm">{template.name}</p>
                        <p className="text-xs text-diletto-gray">
                          {template.template_type === 'pdf' ? 'PDF' : 'DOCX'}
                          {isConfirmed && submission?.submitted_at && (
                            <> · 確認日: {new Date(submission.submitted_at).toLocaleDateString('ja-JP')}</>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isConfirmed ? (
                        <Badge className="bg-diletto-green/10 text-diletto-green border-diletto-green/20">確認済</Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleConfirm(template.id)}
                          disabled={actionId === template.id}
                        >
                          {actionId === template.id ? '処理中...' : '内容を確認しました'}
                        </Button>
                      )}

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
