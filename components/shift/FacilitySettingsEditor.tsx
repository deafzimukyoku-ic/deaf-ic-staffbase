'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { FacilityAreaEditor } from '@/components/shift/FacilityAreaEditor';
import { QualificationEditor } from '@/components/shift/QualificationEditor';
import type { AreaLabel, QualificationType, Facility } from '@/lib/types';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
}

interface SettingsForm {
  pickup_area_labels: AreaLabel[];
  dropoff_area_labels: AreaLabel[];
  qualification_types: QualificationType[];
  min_qualified_staff: number;
  request_deadline_day: number;
  transport_min_end_time: string; // HH:MM
  transport_pickup_cooldown_minutes: number;
}

const EMPTY: SettingsForm = {
  pickup_area_labels: [],
  dropoff_area_labels: [],
  qualification_types: [],
  min_qualified_staff: 2,
  request_deadline_day: 20,
  transport_min_end_time: '15:00',
  transport_pickup_cooldown_minutes: 30,
};

export function FacilitySettingsEditor({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>('');
  const [form, setForm] = useState<SettingsForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadBasics = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: meData } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (!meData) return;
    setMe(meData as MeRow);

    const { data: facData } = await supabase
      .from('facilities')
      .select('id, name, tenant_id, address, created_at')
      .eq('tenant_id', meData.tenant_id)
      .order('created_at');
    const all = (facData as Facility[]) || [];
    const scoped = scope === 'manager' && meData.facility_id
      ? all.filter((f) => f.id === meData.facility_id)
      : all;
    setFacilities(scoped);

    const defaultFac =
      scope === 'manager' && meData.facility_id
        ? meData.facility_id
        : (scoped[0]?.id ?? '');
    setSelectedFacilityId(defaultFac);
  }, [supabase, scope]);

  const loadSettings = useCallback(async () => {
    if (!me || !selectedFacilityId) return;
    const { data } = await supabase
      .from('facility_shift_settings')
      .select('*')
      .eq('facility_id', selectedFacilityId)
      .maybeSingle();

    if (data) {
      setForm({
        pickup_area_labels: Array.isArray(data.pickup_area_labels) ? data.pickup_area_labels : [],
        dropoff_area_labels: Array.isArray(data.dropoff_area_labels) ? data.dropoff_area_labels : [],
        qualification_types: Array.isArray(data.qualification_types) ? data.qualification_types : [],
        min_qualified_staff: data.min_qualified_staff ?? 2,
        request_deadline_day: data.request_deadline_day ?? 20,
        transport_min_end_time: (data.transport_min_end_time ?? '15:00:00').slice(0, 5),
        transport_pickup_cooldown_minutes: data.transport_pickup_cooldown_minutes ?? 30,
      });
    } else {
      setForm(EMPTY);
    }
  }, [supabase, me, selectedFacilityId]);

  useEffect(() => { loadBasics().then(() => setLoading(false)); }, [loadBasics]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  async function handleSave() {
    if (!me || !selectedFacilityId) return;
    setSaving(true);

    const payload = {
      facility_id: selectedFacilityId,
      tenant_id: me.tenant_id,
      min_qualified_staff: form.min_qualified_staff,
      pickup_area_labels: form.pickup_area_labels,
      dropoff_area_labels: form.dropoff_area_labels,
      qualification_types: form.qualification_types,
      request_deadline_day: form.request_deadline_day,
      transport_min_end_time: `${form.transport_min_end_time}:00`,
      transport_pickup_cooldown_minutes: form.transport_pickup_cooldown_minutes,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('facility_shift_settings')
      .upsert(payload, { onConflict: 'facility_id' });

    setSaving(false);
    if (error) {
      toast.error('保存に失敗しました', { description: error.message });
      return;
    }
    toast.success('事業所設定を保存しました');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-diletto-gray">読み込み中...</span>
      </div>
    );
  }

  const selectedFacility = facilities.find((f) => f.id === selectedFacilityId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-3xl">🗺️</span>
        <h1 className="text-2xl font-bold text-diletto-ink">事業所設定</h1>
      </div>

      {/* facility 選択 */}
      {scope === 'admin' && facilities.length > 1 && (
        <Card className="border-diletto-gray/10 shadow-sm rounded-md">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Label className="text-[10px] font-bold text-diletto-gray-light uppercase">設定対象の事業所</Label>
              <select
                value={selectedFacilityId}
                onChange={(e) => setSelectedFacilityId(e.target.value)}
                className="h-10 rounded-md border border-diletto-gray/15 bg-white px-3 text-sm min-w-[200px]"
                aria-label="事業所"
              >
                {facilities.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      {!selectedFacility ? (
        <Card><CardContent className="py-12 text-center text-diletto-gray-light">事業所が登録されていません</CardContent></Card>
      ) : (
        <>
          <Card className="border-diletto-gray/10 shadow-sm rounded-md">
            <CardContent className="py-4">
              <p className="text-xs text-diletto-gray-light mb-1">現在の事業所</p>
              <p className="font-bold text-diletto-ink">{selectedFacility.name}</p>
              {selectedFacility.address && (
                <p className="text-xs text-diletto-gray mt-0.5">{selectedFacility.address}</p>
              )}
            </CardContent>
          </Card>

          {/* 送迎エリア */}
          <FacilityAreaEditor
            label="🚐 迎えエリア"
            areas={form.pickup_area_labels}
            onChange={(next) => setForm({ ...form, pickup_area_labels: next })}
          />
          <FacilityAreaEditor
            label="🏠 送りエリア"
            areas={form.dropoff_area_labels}
            onChange={(next) => setForm({ ...form, dropoff_area_labels: next })}
          />

          {/* 資格リスト */}
          <QualificationEditor
            quals={form.qualification_types}
            onChange={(next) => setForm({ ...form, qualification_types: next })}
          />

          {/* 数値系設定 */}
          <Card className="border-diletto-gray/10 shadow-sm rounded-md">
            <CardContent className="py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-bold">
                    有資格者の最低出勤人数
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.min_qualified_staff}
                    onChange={(e) => setForm({ ...form, min_qualified_staff: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                    className="h-10"
                  />
                  <p className="text-[10px] text-diletto-gray-light">資格リストで「カウント対象」の資格を持つ職員がこの人数以上出勤するようシフトを組みます</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-bold">休み希望の提出締切日</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-diletto-gray">毎月</span>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={form.request_deadline_day}
                      onChange={(e) => setForm({ ...form, request_deadline_day: Math.min(31, Math.max(1, parseInt(e.target.value || '20', 10))) })}
                      className="h-10 w-24"
                    />
                    <span className="text-xs text-diletto-gray">日</span>
                  </div>
                  <p className="text-[10px] text-diletto-gray-light">翌月分の休み希望をこの日までに職員が提出する運用</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-bold">送迎担当の最低退勤時刻</Label>
                  <Input
                    type="time"
                    value={form.transport_min_end_time}
                    onChange={(e) => setForm({ ...form, transport_min_end_time: e.target.value })}
                    className="h-10"
                  />
                  <p className="text-[10px] text-diletto-gray-light">この時刻以降に退勤する職員のみ送り担当の候補にします</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-bold">迎えクールダウン（分）</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.transport_pickup_cooldown_minutes}
                    onChange={(e) => setForm({ ...form, transport_pickup_cooldown_minutes: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                    className="h-10"
                  />
                  <p className="text-[10px] text-diletto-gray-light">同じ職員が迎えを連続で担当しない間隔。30分以下なら同便扱い</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2 sticky bottom-6 bg-diletto-beige/80 backdrop-blur rounded-md p-2">
            <Button onClick={handleSave} disabled={saving} size="lg">
              {saving ? '保存中...' : '💾 設定を保存'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
