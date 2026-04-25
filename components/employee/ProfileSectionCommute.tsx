'use client';

import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Employee } from '@/lib/types';

const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/* 免許種別マスタ（ハードコード）。「その他」選択時のみ自由入力欄が出る。
   将来 DB マスタ化したくなったら facility_shift_settings 等に移すが、変更頻度が低いのでひとまず固定。 */
const LICENSE_TYPES: readonly string[] = [
  '普通自動車第一種',
  '普通自動車第一種（AT限定）',
  '普通自動車第二種',
  '準中型自動車第一種',
  '中型自動車第一種',
  '中型自動車第二種',
  '大型自動車第一種',
  '大型自動車第二種',
  'その他',
];

type CommuteFields = Pick<Employee,
  'has_car_commute' | 'is_shuttle_driver' |
  'car_model' | 'car_plate_number' | 'license_type' | 'license_number' |
  'license_expiry' | 'insurance_company' | 'insurance_policy_number' |
  'insurance_expiry' | 'vehicle_inspection_expiry' |
  'commute_distance' |
  'driving_experience' | 'accident_history' | 'training_attendance' |
  'license_image_path' | 'license_image_back_path' | 'commute_route_image_path' |
  'commute_method' | 'commute_time_minutes' |
  'route_section1_route' | 'route_section1_transport' | 'route_section1_cost' |
  'route_section2_route' | 'route_section2_transport' | 'route_section2_cost' |
  'commute_route_detail'
>;

interface Props {
  data: CommuteFields;
  onChange: (data: CommuteFields) => void;
  employeeId?: string;
}

export function ProfileSectionCommute({ data, onChange, employeeId }: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const supabase = createClient();

  function update<K extends keyof CommuteFields>(key: K, value: CommuteFields[K]) {
    onChange({ ...data, [key]: value });
  }

  async function handleImageUpload(fieldKey: string, file: File) {
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
      // テナントIDを取得
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('認証が必要です'); return; }
      const { data: me } = await supabase.from('employees').select('id, tenant_id').eq('auth_user_id', user.id).single();
      if (!me) { toast.error('社員情報が見つかりません'); return; }

      const targetId = employeeId || me.id;
      const ext = file.name.split('.').pop() || 'jpg';
      const storagePath = `${me.tenant_id}/${targetId}/${fieldKey}_${Date.now()}.${ext}`;

      // Supabase Storageに直接アップロード（Vercelの4.5MB制限を回避）
      const { error: uploadErr } = await supabase.storage
        .from('employee-images')
        .upload(storagePath, file, { contentType: file.type, upsert: true });

      if (uploadErr) {
        toast.error(`アップロードに失敗しました: ${uploadErr.message}`);
        return;
      }

      // APIでDB更新のみ
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
      update(fieldKey as keyof CommuteFields, json.path);
      toast.success('画像をアップロードしました');
    } catch {
      toast.error('アップロード中にエラーが発生しました');
    } finally {
      setUploading(null);
    }
  }

  const showDrivingFields = data.has_car_commute || data.is_shuttle_driver;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>通勤・車両情報</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="flex items-center gap-3 rounded-md border border-diletto-gray/15 p-3 cursor-pointer hover:bg-diletto-beige transition-colors">
              <input
                type="checkbox"
                checked={data.has_car_commute}
                onChange={(e) => update('has_car_commute', e.target.checked)}
                className="h-4 w-4 rounded accent-diletto-blue"
              />
              <div>
                <span className="text-sm font-medium">マイカー通勤</span>
                <p className="text-xs text-diletto-gray">自家用車で通勤する場合</p>
              </div>
            </label>
            <label className="flex items-center gap-3 rounded-md border border-diletto-gray/15 p-3 cursor-pointer hover:bg-diletto-beige transition-colors">
              <input
                type="checkbox"
                checked={data.commute_method === 'public_transport'}
                onChange={(e) => update('commute_method', e.target.checked ? 'public_transport' : null)}
                className="h-4 w-4 rounded accent-diletto-blue"
              />
              <div>
                <span className="text-sm font-medium">公共交通機関</span>
                <p className="text-xs text-diletto-gray">電車・バスで通勤する場合</p>
              </div>
            </label>
            <label className="flex items-center gap-3 rounded-md border border-diletto-gray/15 p-3 cursor-pointer hover:bg-diletto-beige transition-colors">
              <input
                type="checkbox"
                checked={data.is_shuttle_driver}
                onChange={(e) => update('is_shuttle_driver', e.target.checked)}
                className="h-4 w-4 rounded accent-diletto-blue"
              />
              <div>
                <span className="text-sm font-medium">送迎運転者</span>
                <p className="text-xs text-diletto-gray">送迎車両の運転を担当する場合</p>
              </div>
            </label>
          </div>

          {/* 通勤経路画像（誰でもアップロード可能。Google マップで自宅と施設の経路をスクショして添付してもらう） */}
          <div className="border-t border-diletto-gray/10 pt-4 space-y-2">
            <p className="text-sm font-medium text-diletto-blue">通勤経路の画像</p>
            <p className="text-xs text-diletto-gray">
              📍 Google マップで「自宅 → 施設」の経路を検索し、ルートが見える状態でスクリーンショットを撮ってアップロードしてください。
            </p>
            <ImageUploadField
              label="通勤経路スクリーンショット"
              path={data.commute_route_image_path || null}
              fieldKey="commute_route_image_path"
              uploading={uploading === 'commute_route_image_path'}
              onUpload={handleImageUpload}
              onClear={() => update('commute_route_image_path', null)}
            />
          </div>

          {/* 公共交通機関の区間情報 */}
          {data.commute_method === 'public_transport' && (
            <div className="border-t border-diletto-gray/10 pt-4 space-y-4">
              <p className="text-sm font-medium text-diletto-blue">通勤経路</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>通勤時間（分）</Label>
                  <Input type="number" value={data.commute_time_minutes ?? ''} onChange={(e) => update('commute_time_minutes', e.target.value ? Number(e.target.value) : null)} placeholder="30" />
                </div>
                <Field label="通勤距離（km）" value={data.commute_distance || ''} onChange={(v) => update('commute_distance', v || null)} />
              </div>

              <p className="text-xs font-medium text-diletto-ink mt-2">区間 1</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="乗車区間" value={data.route_section1_route || ''} onChange={(v) => update('route_section1_route', v || null)} placeholder="名古屋 → 栄" />
                <Field label="利用機関" value={data.route_section1_transport || ''} onChange={(v) => update('route_section1_transport', v || null)} placeholder="地下鉄東山線" />
                <div className="space-y-2">
                  <Label>金額（円）</Label>
                  <Input type="number" value={data.route_section1_cost ?? ''} onChange={(e) => update('route_section1_cost', e.target.value ? Number(e.target.value) : null)} />
                </div>
              </div>

              <p className="text-xs font-medium text-diletto-ink mt-2">区間 2（任意）</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="乗車区間" value={data.route_section2_route || ''} onChange={(v) => update('route_section2_route', v || null)} />
                <Field label="利用機関" value={data.route_section2_transport || ''} onChange={(v) => update('route_section2_transport', v || null)} />
                <div className="space-y-2">
                  <Label>金額（円）</Label>
                  <Input type="number" value={data.route_section2_cost ?? ''} onChange={(e) => update('route_section2_cost', e.target.value ? Number(e.target.value) : null)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>通勤経路（詳細）</Label>
                <Textarea value={data.commute_route_detail || ''} onChange={(e) => update('commute_route_detail', e.target.value || null)} placeholder="自宅→○○駅→△△駅→徒歩→会社" rows={2} />
              </div>
            </div>
          )}

          {/* 免許情報（マイカー通勤 OR 送迎運転者 ならどちらでも表示） */}
          {showDrivingFields && (
            <div className="border-t border-diletto-gray/10 pt-4 space-y-4">
              <p className="text-sm font-medium text-diletto-blue">免許情報</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>免許種別</Label>
                  <select
                    value={LICENSE_TYPES.includes(data.license_type ?? '') ? (data.license_type ?? '') : (data.license_type ? 'その他' : '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'その他') {
                        /* 「その他」選択時は空文字にして自由入力欄を表示 */
                        update('license_type', '');
                      } else {
                        update('license_type', v || null);
                      }
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  >
                    <option value="">選択してください</option>
                    {LICENSE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {/* 「その他」が選ばれている、または既存値がプルダウン候補に含まれない場合、自由入力欄を出す */}
                  {(data.license_type !== null && !LICENSE_TYPES.includes(data.license_type ?? '')) && (
                    <Input
                      value={data.license_type || ''}
                      onChange={(e) => update('license_type', e.target.value || null)}
                      placeholder="その他の免許種別を入力"
                    />
                  )}
                </div>
                <Field label="免許証番号" value={data.license_number || ''} onChange={(v) => update('license_number', v || null)} />
              </div>
              <div className="space-y-2">
                <Label>免許有効期限</Label>
                <Input type="date" value={data.license_expiry || ''} onChange={(e) => update('license_expiry', e.target.value || null)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ImageUploadField
                  label="免許証の写真（表面）*"
                  path={data.license_image_path || null}
                  fieldKey="license_image_path"
                  uploading={uploading === 'license_image_path'}
                  onUpload={handleImageUpload}
                  onClear={() => update('license_image_path', null)}
                />
                <ImageUploadField
                  label="免許証の写真（裏面）*"
                  path={data.license_image_back_path || null}
                  fieldKey="license_image_back_path"
                  uploading={uploading === 'license_image_back_path'}
                  onUpload={handleImageUpload}
                  onClear={() => update('license_image_back_path', null)}
                />
              </div>
              <p className="text-[11px] text-diletto-gray-light">
                ※ 表面・裏面ともに必須。記載事項変更欄を含めて全部撮影してください。
              </p>
            </div>
          )}

          {data.has_car_commute && (
            <div className="border-t border-diletto-gray/10 pt-4 space-y-4">
              <p className="text-sm font-medium text-diletto-blue">車両情報</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="車種" value={data.car_model || ''} onChange={(v) => update('car_model', v || null)} placeholder="トヨタ プリウス" />
                <Field label="ナンバープレート" value={data.car_plate_number || ''} onChange={(v) => update('car_plate_number', v || null)} placeholder="名古屋 300 あ 1234" />
              </div>

              <p className="text-sm font-medium text-diletto-blue pt-2">任意保険</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="契約保険会社" value={data.insurance_company || ''} onChange={(v) => update('insurance_company', v || null)} />
                <Field label="保険証券番号" value={data.insurance_policy_number || ''} onChange={(v) => update('insurance_policy_number', v || null)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>保険有効期限</Label>
                  <Input type="date" value={data.insurance_expiry || ''} onChange={(e) => update('insurance_expiry', e.target.value || null)} />
                </div>
                <div className="space-y-2">
                  <Label>車検有効期限</Label>
                  <Input type="date" value={data.vehicle_inspection_expiry || ''} onChange={(e) => update('vehicle_inspection_expiry', e.target.value || null)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>通勤距離（km）</Label>
                <Input type="number" step="0.1" value={data.commute_distance || ''} onChange={(e) => update('commute_distance', e.target.value || null)} />
              </div>

            </div>
          )}

          {showDrivingFields && (
            <div className="border-t border-diletto-gray/10 pt-4 space-y-4">
              <p className="text-sm font-medium text-diletto-blue">運転者情報</p>
              <div className="space-y-2">
                <Label>運転経歴</Label>
                <Textarea value={data.driving_experience || ''} onChange={(e) => update('driving_experience', e.target.value || null)} placeholder="期間と内容" rows={3} />
              </div>
              <div className="space-y-2">
                <Label>事故・違反歴</Label>
                <Textarea value={data.accident_history || ''} onChange={(e) => update('accident_history', e.target.value || null)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>講習受講歴</Label>
                <Textarea value={data.training_attendance || ''} onChange={(e) => update('training_attendance', e.target.value || null)} rows={2} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImageUploadField({ label, path, fieldKey, uploading, onUpload, onClear }: {
  label: string;
  path: string | null;
  fieldKey: string;
  uploading: boolean;
  onUpload: (fieldKey: string, file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageUrl = path
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/employee-images/${path}`
    : null;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {imageUrl ? (
        <div className="space-y-2">
          <img src={imageUrl} alt={label} className="max-h-48 rounded-md border object-contain" />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              変更
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-diletto-red" onClick={onClear}>
              削除
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center w-full h-24 rounded-md border-2 border-dashed border-diletto-gray/20 hover:border-diletto-blue/40 transition-colors text-sm text-diletto-gray cursor-pointer"
        >
          {uploading ? 'アップロード中...' : 'クリックして画像を選択'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(fieldKey, file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
