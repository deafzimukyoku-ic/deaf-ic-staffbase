'use client';

import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

interface ImageFieldDef {
  field_key: string;
  label: string;
  field_type: string;
}

interface Props {
  employeeId: string;
  tenantId: string;
  licensePath: string | null;
  /** 免許証 裏面（migration 117）。社員プロフィールで両面アップロード可能。 */
  licenseBackPath?: string | null;
  commuteRoutePath: string | null;
  customFields: Record<string, string> | null;
  customFieldDefs: ImageFieldDef[];
  /** true = アップロード可能、false = 閲覧のみ */
  editable?: boolean;
  onImageUpdated?: (fieldKey: string, path: string) => void;
  /** true: 免許証(表/裏) / 通勤経路の固定枠を非表示（社員側 /my/documents 用。
       これらは ProfileSectionCommute（通勤・車両情報）に移動した）。 */
  hideDriverFixedImages?: boolean;
}

export function EmployeeImagesCard({
  employeeId,
  tenantId,
  licensePath,
  licenseBackPath = null,
  commuteRoutePath,
  customFields,
  customFieldDefs,
  editable = false,
  onImageUpdated,
  hideDriverFixedImages = false,
}: Props) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabase = createClient();
  const [uploading, setUploading] = useState<string | null>(null);

  // 固定画像 + カスタム画像フィールドを統合（hideDriverFixedImages=true なら固定 3 枠を除外）
  const fixedImages: { fieldKey: string; label: string; path: string | null }[] = hideDriverFixedImages
    ? []
    : [
        { fieldKey: 'license_image_path', label: '免許証の写真（表面）', path: licensePath },
        { fieldKey: 'license_image_back_path', label: '免許証の写真（裏面）', path: licenseBackPath },
        { fieldKey: 'commute_route_image_path', label: '通勤経路の画像', path: commuteRoutePath },
      ];

  const customImages = customFieldDefs
    .filter((d) => d.field_type === 'image')
    .map((d) => ({
      fieldKey: d.field_key,
      label: d.label,
      path: customFields?.[d.field_key] || null,
    }));

  const allImages = [...fixedImages, ...customImages];

  async function handleUpload(fieldKey: string, file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('JPG、PNG、WebP、HEIC形式のみ対応しています');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      toast.error(`ファイルサイズは${MAX_IMAGE_SIZE_MB}MB以下にしてください`);
      return;
    }

    setUploading(fieldKey);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const storagePath = `${tenantId}/${employeeId}/${fieldKey}_${Date.now()}.${ext}`;

      // Supabase Storageに直接アップロード
      const { error: uploadErr } = await supabase.storage
        .from('employee-images')
        .upload(storagePath, file, { contentType: file.type, upsert: true });

      if (uploadErr) {
        toast.error(`アップロードに失敗しました: ${uploadErr.message}`);
        return;
      }

      // APIでDB更新
      const res = await fetch('/api/employees/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_key: fieldKey, storage_path: storagePath, employee_id: employeeId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'DB更新に失敗しました');
        return;
      }

      onImageUpdated?.(fieldKey, json.path);
      toast.success('画像をアップロードしました');
    } catch {
      toast.error('アップロード中にエラーが発生しました');
    } finally {
      setUploading(null);
    }
  }

  // 閲覧モード: 画像がなければ何も表示しない
  if (!editable && allImages.every((img) => !img.path)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">提出画像</CardTitle>
        {editable && (
          <p className="text-xs text-brand-gray mt-1">免許証・通勤経路など必要な画像をアップロードしてください</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {allImages.map((img) => (
            <ImageSlot
              key={img.fieldKey}
              label={img.label}
              path={img.path}
              fieldKey={img.fieldKey}
              editable={editable}
              uploading={uploading === img.fieldKey}
              supabaseUrl={supabaseUrl}
              onUpload={handleUpload}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ImageSlot({ label, path, fieldKey, editable, uploading, supabaseUrl, onUpload }: {
  label: string;
  path: string | null;
  fieldKey: string;
  editable: boolean;
  uploading: boolean;
  supabaseUrl: string | undefined;
  onUpload: (fieldKey: string, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageUrl = path
    ? `${supabaseUrl}/storage/v1/object/public/employee-images/${path}`
    : null;

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {imageUrl ? (
        <div className="space-y-2">
          <img src={imageUrl} alt={label} className="max-h-48 rounded-md border object-contain w-full" />
          <div className="flex gap-2">
            {editable && (
              <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
                {uploading ? 'アップロード中...' : '変更'}
              </Button>
            )}
            {!editable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await fetch(imageUrl);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const ext = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
                    a.download = `${label}.${ext}`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {
                    toast.error('画像のダウンロードに失敗しました');
                  }
                }}
              >
                ダウンロード
              </Button>
            )}
          </div>
        </div>
      ) : editable ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center w-full h-24 rounded-md border-2 border-dashed border-brand-gray/20 hover:border-brand-blue/40 transition-colors text-sm text-brand-gray cursor-pointer"
        >
          {uploading ? 'アップロード中...' : 'クリックして画像を選択'}
        </button>
      ) : (
        <p className="text-xs text-brand-gray-light">未アップロード</p>
      )}
      {editable && (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(fieldKey, file);
            e.target.value = '';
          }}
        />
      )}
    </div>
  );
}
