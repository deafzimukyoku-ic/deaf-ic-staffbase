'use client';

/**
 * カスタム項目カード（社員プロフィールの各セクションで共通利用）
 *
 * settings 画面で section='basic'|'commute'|'contacts' を割り当てると、
 * プロフィールの該当タブにこのカードが出る。
 *
 * 見出し文言は CUSTOM_FIELD_SECTION_TITLES から決まる
 * （例: basic → 「その他の基本情報」）。
 */

import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  CUSTOM_FIELD_SECTION_TITLES,
  type CustomEmployeeField,
  type CustomFieldSection,
} from '@/lib/types';

interface Props {
  section: CustomFieldSection;
  defs: CustomEmployeeField[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  employeeId?: string;
}

export function CustomFieldsCard({ section, defs, values, onChange, employeeId }: Props) {
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const supabase = createClient();

  if (defs.length === 0) return null;

  function updateValue(key: string, value: string | null) {
    onChange({ ...values, [key]: value || '' });
  }

  async function handleImageUpload(fieldKey: string, file: File) {
    const maxSizeMb = 10;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('JPG、PNG、WebP、HEIC形式のみ対応しています');
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      toast.error(`ファイルサイズは${maxSizeMb}MB以下にしてください`);
      return;
    }

    setUploadingField(fieldKey);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('認証が必要です'); return; }
      const { data: me } = await supabase
        .from('employees').select('id, tenant_id').eq('auth_user_id', user.id).single();
      if (!me) { toast.error('社員情報が見つかりません'); return; }

      const targetId = employeeId || me.id;
      const ext = file.name.split('.').pop() || 'jpg';
      const storagePath = `${me.tenant_id}/${targetId}/${fieldKey}_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('employee-images')
        .upload(storagePath, file, { contentType: file.type, upsert: true });
      if (uploadErr) { toast.error(`アップロードに失敗しました: ${uploadErr.message}`); return; }

      const res = await fetch('/api/employees/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_key: fieldKey, storage_path: storagePath, employee_id: employeeId }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error); return; }
      updateValue(fieldKey, json.path);
      toast.success('画像をアップロードしました');
    } catch { toast.error('アップロードに失敗しました'); }
    finally { setUploadingField(null); }
  }

  const selectClass =
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{CUSTOM_FIELD_SECTION_TITLES[section]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {defs.map((cf) => {
          const val = values[cf.field_key] || '';

          if (cf.field_type === 'image') {
            const imageUrl = val
              ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/employee-images/${val}`
              : null;
            return (
              <div key={cf.field_key} className="space-y-2">
                <Label>{cf.label}</Label>
                {imageUrl ? (
                  <div className="space-y-2">
                    <img src={imageUrl} alt={cf.label} className="max-h-48 rounded-md border object-contain" />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
                        input.onchange = (e) => {
                          const f = (e.target as HTMLInputElement).files?.[0];
                          if (f) handleImageUpload(cf.field_key, f);
                        };
                        input.click();
                      }}>変更</Button>
                      <Button type="button" size="sm" variant="ghost" className="text-diletto-red"
                        onClick={() => updateValue(cf.field_key, null)}>削除</Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={uploadingField === cf.field_key}
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
                      input.onchange = (e) => {
                        const f = (e.target as HTMLInputElement).files?.[0];
                        if (f) handleImageUpload(cf.field_key, f);
                      };
                      input.click();
                    }}
                    className="flex items-center justify-center w-full h-24 rounded-md border-2 border-dashed border-diletto-gray/20 hover:border-diletto-blue/40 transition-colors text-sm text-diletto-gray cursor-pointer"
                  >
                    {uploadingField === cf.field_key ? 'アップロード中...' : 'クリックして画像を選択'}
                  </button>
                )}
              </div>
            );
          }

          if (cf.field_type === 'select') {
            return (
              <div key={cf.field_key} className="space-y-2">
                <Label>{cf.label}</Label>
                <select className={selectClass} value={val}
                  onChange={(e) => updateValue(cf.field_key, e.target.value || null)}>
                  <option value="">未選択</option>
                  {cf.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            );
          }

          if (cf.field_type === 'date') {
            return (
              <div key={cf.field_key} className="space-y-2">
                <Label>{cf.label}</Label>
                <Input type="date" value={val}
                  onChange={(e) => updateValue(cf.field_key, e.target.value || null)} />
              </div>
            );
          }

          if (cf.field_type === 'number') {
            return (
              <div key={cf.field_key} className="space-y-2">
                <Label>{cf.label}</Label>
                <Input type="number" value={val}
                  onChange={(e) => updateValue(cf.field_key, e.target.value || null)} />
              </div>
            );
          }

          return (
            <div key={cf.field_key} className="space-y-2">
              <Label>{cf.label}</Label>
              <Input value={val}
                onChange={(e) => updateValue(cf.field_key, e.target.value || null)} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
