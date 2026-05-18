'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DocumentUploader } from '@/components/admin/DocumentUploader';
import { toast } from 'sonner';

export default function NewDocumentPage() {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  /* migration 119: visibility_condition 廃止。タグの required+source_field から自動判定 */
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase
        .from('employees')
        .select('tenant_id')
        .eq('auth_user_id', user.id)
        .single();
      if (me) setTenantId(me.tenant_id);
    }
    load();
  }, []);

  function handleUploaded(f: File, phs: string[]) {
    setFile(f);
    setPlaceholders(phs);
    if (!name) setName(f.name.replace('.docx', ''));
  }

  async function handleSave() {
    if (!file || !tenantId || !name.trim()) return;
    setSaving(true);

    // 1. Storageにアップロード
    const path = `${tenantId}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(path, file);

    if (uploadErr) {
      toast.error('アップロードに失敗しました', { description: uploadErr.message });
      setSaving(false);
      return;
    }

    // 2. 初期マッピング（全て form_data として仮設定）
    const initialMapping = placeholders.map((key) => ({
      key,
      source_type: 'form_data' as const,
      source_field: key,
      label: key,
      input_type: 'text' as const,
      options: null,
      required: false,
    }));

    // 3. document_templates レコード作成
    const { data: template, error: dbErr } = await supabase
      .from('document_templates')
      .insert({
        tenant_id: tenantId,
        name: name.trim(),
        docx_storage_path: path,
        mapping: initialMapping,
      })
      .select()
      .single();

    if (dbErr || !template) {
      toast.error('保存に失敗しました', { description: dbErr?.message });
      setSaving(false);
      return;
    }

    toast.success('テンプレートを登録しました');
    router.push(`/admin/documents/${template.id}/mapping`);
  }

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => router.push('/admin/documents')}
        className="flex items-center gap-1 text-sm text-brand-gray hover:text-brand-ink transition-colors mb-4"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        書類テンプレートに戻る
      </button>
      <h1 className="text-2xl font-bold mb-6">書類テンプレート追加</h1>

      <div className="space-y-6">
        <DocumentUploader onUploaded={handleUploaded} loading={saving} />

        {placeholders.length > 0 && (
          <>
            <div className="space-y-2">
              <Label>検出されたプレースホルダ</Label>
              <div className="flex flex-wrap gap-2">
                {placeholders.map((p) => (
                  <Badge key={p} variant="outline" className="font-mono">{`{{${p}}}`}</Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>書類名</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="入社誓約書" />
            </div>

            <div className="text-[11px] text-brand-gray-light leading-relaxed bg-brand-blue/5 border border-brand-blue/10 rounded-md p-2.5">
              💡 表示条件は **タグから自動判定** されます。<br />
              書類のタグに「免許番号」「マイカー車種」など特定社員にしか該当しない項目があれば、
              該当する社員にだけ書類が表示されます（マイカー通勤者・送迎運転者など）。<br />
              すべての社員にとって必須でない（任意提出の）書類にしたい場合は、
              タグの「必須」を外してください。
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => router.push('/admin/documents')}>キャンセル</Button>
              <Button onClick={handleSave} disabled={saving || !name.trim()} className="flex-1">
                {saving ? '保存中...' : '保存してマッピング設定へ'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
