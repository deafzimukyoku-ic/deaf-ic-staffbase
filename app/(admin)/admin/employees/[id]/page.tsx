'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { EMPLOYEE_ROLES } from '@/lib/constants';
import { AIDiagnosisPanel } from '@/components/admin/AIDiagnosisPanel';
import { EmployeeImagesCard } from '@/components/employee/EmployeeImagesCard';
import type { Employee, DocumentTemplate, DocumentSubmission, Facility } from '@/lib/types';

const ROLE_LABELS: Record<string, string> = {
  employee: '一般社員',
  manager: 'マネージャー',
  admin: '管理者',
};

const WORK_STYLE_LABELS: Record<string, string> = {
  solo: '一人で進める',
  team: 'チームで協力',
  clear: '指示が明確',
  autonomy: '裁量に任される',
  stable: '安定・着実',
  change: '変化・スピード',
  think: 'じっくり考える',
  act: 'すぐに行動する',
  either: 'どちらも',
};

const COMM_LABELS: Record<string, string> = {
  conclusion: '結論から',
  context: '背景から',
  immediate: 'すぐ相談',
  organized: '整理して相談',
  frank: '率直に',
  structured: '順を追って',
  face_to_face: '対面重視',
  digital: 'チャット/メール重視',
  either: 'どちらでも',
};

interface PositionMaster {
  id: string;
  name: string;
}

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retireDate, setRetireDate] = useState(new Date().toISOString().split('T')[0]);
  const [retireLoading, setRetireLoading] = useState(false);
  // ロール管理
  const [roleValue, setRoleValue] = useState('');
  const [roleSaving, setRoleSaving] = useState(false);
  // マネージャー担当施設
  const [allFacilitiesMaster, setAllFacilitiesMaster] = useState<{ id: string; name: string }[]>([]);
  const [mgrFacilities, setMgrFacilities] = useState<string[]>([]);
  const [newFacility, setNewFacility] = useState('');
  // 施設
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [facilityEditing, setFacilityEditing] = useState(false);
  const [facilityDraftId, setFacilityDraftId] = useState<string>('');
  const [facilitySaving, setFacilitySaving] = useState(false);
  // 書類提出状況
  const [docItems, setDocItems] = useState<{ template: DocumentTemplate; submission: DocumentSubmission | null }[]>([]);
  const [imageFieldDefs, setImageFieldDefs] = useState<{ field_key: string; label: string; field_type: string }[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  // 役職
  const [allPositions, setAllPositions] = useState<PositionMaster[]>([]);
  const [posEditing, setPosEditing] = useState(false);
  const [posDraftId, setPosDraftId] = useState('');
  const [posSaving, setPosSaving] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();

      const emp = data as Employee | null;
      setEmployee(emp);
      if (emp) {
        setRoleValue(emp.role);

        // 施設一覧を取得（編集用セレクト + 現施設名表示）
        const { data: facs } = await supabase
          .from('facilities')
          .select('id, tenant_id, name, address, created_at')
          .eq('tenant_id', emp.tenant_id)
          .order('created_at');
        setAllFacilities((facs as Facility[]) || []);
        setAllFacilitiesMaster((facs as Facility[]) || []);
        setFacilityDraftId(emp.facility_id || '');
        if (emp.facility_id) {
          const cur = (facs || []).find((f) => f.id === emp.facility_id);
          if (cur) setFacilityName(cur.name);
        }

        // 役職マスター
        const { data: positions } = await supabase
          .from('positions')
          .select('id, name')
          .eq('tenant_id', emp.tenant_id)
          .order('display_order');
        setAllPositions((positions as PositionMaster[]) || []);
        setPosDraftId(emp.position_id || '');

        // マネージャー担当施設
        const { data: mFacs } = await supabase
          .from('manager_facilities')
          .select('facility_id')
          .eq('employee_id', emp.id);
        setMgrFacilities((mFacs || []).map((f) => f.facility_id));

        // 書類テンプレート + 提出データ
        const { data: templates } = await supabase
          .from('document_templates')
          .select('*')
          .eq('tenant_id', emp.tenant_id)
          .order('display_order');

        const { data: submissions } = await supabase
          .from('document_submissions')
          .select('*')
          .eq('employee_id', emp.id);

        // 画像タイプのカスタムフィールド定義
        const { data: imgDefs } = await supabase
          .from('custom_employee_fields')
          .select('field_key, label, field_type')
          .eq('tenant_id', emp.tenant_id)
          .eq('field_type', 'image')
          .eq('is_active', true);
        if (imgDefs) setImageFieldDefs(imgDefs);

        const subMap = new Map((submissions || []).map((s) => [s.document_template_id, s as DocumentSubmission]));
        /* migration 119 自動判定: lib/document-applicability で対象書類を絞り込み */
        const { isDocumentApplicable, loadCustomFieldGates } = await import('@/lib/document-applicability');
        const customGates = await loadCustomFieldGates(supabase, emp.tenant_id);
        const items = ((templates || []) as DocumentTemplate[])
          .filter((t) => isDocumentApplicable(t, emp as unknown as import('@/lib/types').Employee, customGates))
          .map((t) => ({ template: t, submission: subMap.get(t.id) || null }));
        setDocItems(items);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleRoleChange(newRole: string) {
    if (!employee) return;
    setRoleSaving(true);
    const { error } = await supabase
      .from('employees')
      .update({ role: newRole })
      .eq('id', employee.id);
    if (error) {
      toast.error('ロール変更に失敗しました');
      setRoleSaving(false);
      return;
    }
    setRoleValue(newRole);
    setEmployee({ ...employee, role: newRole as Employee['role'] });
    toast.success(`ロールを「${ROLE_LABELS[newRole]}」に変更しました`);
    setRoleSaving(false);

    // manager以外に変更したら担当施設をクリア
    if (newRole !== 'manager') {
      if (mgrFacilities.length > 0) await supabase.from('manager_facilities').delete().eq('employee_id', employee.id);
      setMgrFacilities([]);
    }
  }

  async function addFacility(facId: string) {
    if (!employee || !facId) return;
    const { error } = await supabase
      .from('manager_facilities')
      .insert({ employee_id: employee.id, facility_id: facId });
    if (error) {
      if (error.code === '23505') toast.error('既に追加済みの施設です');
      else toast.error('追加に失敗しました');
      return;
    }
    setMgrFacilities((prev) => [...prev, facId]);
    setNewFacility('');
    const fName = allFacilitiesMaster.find(f => f.id === facId)?.name || '選択した施設';
    toast.success(`「${fName}」を担当施設に追加しました`);

    // もし本人の所属施設が未設定なら、最初の担当施設を所属として自動設定
    if (!employee.facility_id) {
      const { error: syncErr } = await supabase
        .from('employees')
        .update({ facility_id: facId })
        .eq('id', employee.id);

      if (!syncErr) {
        setEmployee({ ...employee, facility_id: facId });
        setFacilityName(fName);
        setFacilityDraftId(facId);
        toast.info(`本人の所属施設として「${fName}」を自動設定しました`);
      }
    }
  }

  async function removeFacility(facId: string) {
    if (!employee) return;
    const { error } = await supabase
      .from('manager_facilities')
      .delete()
      .eq('employee_id', employee.id)
      .eq('facility_id', facId);
    if (error) { toast.error('削除に失敗しました'); return; }

    const fName = allFacilitiesMaster.find(f => f.id === facId)?.name || '選択した施設';
    setMgrFacilities((prev) => prev.filter((f) => f !== facId));
    toast.success(`「${fName}」を担当施設から外しました`);
  }

  async function handleRetire() {
    if (!employee) return;
    setRetireLoading(true);

    const { error } = await supabase
      .from('employees')
      .update({
        status: 'retired',
        retirement_date: retireDate,
        retirement_reason: retireReason || null,
      })
      .eq('id', employee.id);

    if (error) {
      toast.error('退職処理に失敗しました', { description: error.message });
      setRetireLoading(false);
      return;
    }

    toast.success('退職処理が完了しました');
    setRetireOpen(false);
    setEmployee({ ...employee, status: 'retired' as const, retirement_date: retireDate, retirement_reason: retireReason });
    setRetireLoading(false);
  }

  async function handleSaveFacility() {
    if (!employee) return;
    setFacilitySaving(true);
    const newId = facilityDraftId || null;
    const { error } = await supabase
      .from('employees')
      .update({ facility_id: newId })
      .eq('id', employee.id);
    if (error) {
      toast.error('施設の保存に失敗しました', { description: error.message });
      setFacilitySaving(false);
      return;
    }
    setEmployee({ ...employee, facility_id: newId });
    setFacilityName(newId ? (allFacilities.find((f) => f.id === newId)?.name || null) : null);
    setFacilityEditing(false);
    setFacilitySaving(false);
    toast.success('施設を更新しました');
  }

  async function handleSavePosition() {
    if (!employee) return;
    setPosSaving(true);
    const newId = posDraftId || null;
    const newName = allPositions.find(p => p.id === newId)?.name || null;
    const { error } = await supabase
      .from('employees')
      .update({
        position_id: newId,
        position: newName
      })
      .eq('id', employee.id);
    if (error) {
      toast.error('役職の保存に失敗しました');
      setPosSaving(false);
      return;
    }
    setEmployee({ ...employee, position_id: newId, position: newName });
    setPosEditing(false);
    setPosSaving(false);
    toast.success('役職を更新しました');
  }

  async function handleDownloadPdf(employeeId: string, templateId: string, templateName: string) {
    setDownloadingId(templateId);
    try {
      const res = await fetch('/api/documents/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, template_id: templateId }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'ダウンロードに失敗しました');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('ダウンロードに失敗しました');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleBulkDownload() {
    if (!employee) return;
    setBulkDownloading(true);
    try {
      const res = await fetch('/api/documents/bulk-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || '一括ダウンロードに失敗しました');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${employee.last_name}${employee.first_name}_documents.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('一括ダウンロードに失敗しました');
    } finally {
      setBulkDownloading(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;
  }

  if (!employee) {
    return <p className="text-diletto-red">社員が見つかりません</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {employee.last_name} {employee.first_name}
            </h1>
            {employee.status === 'active' ? (
              <Badge className="bg-diletto-green/10 text-diletto-green border-diletto-green/20">在籍</Badge>
            ) : (
              <Badge className="bg-diletto-red/[0.06] text-diletto-red border-diletto-red/15">退職</Badge>
            )}
          </div>
          <p className="text-sm text-diletto-gray mt-1">
            {employee.employee_number} / {employee.email}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/admin/employees')}>
            一覧に戻る
          </Button>
          {employee.status === 'active' && (
            <Button
              variant="outline"
              className="text-diletto-red border-diletto-red/30"
              onClick={() => setRetireOpen(true)}
            >
              退職処理
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-10 bg-diletto-beige/30 p-1">
          <TabsTrigger value="dashboard" className="px-4 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">ダッシュボード</TabsTrigger>
          <TabsTrigger value="basic" className="px-4 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">基本情報</TabsTrigger>
          <TabsTrigger value="about" className="px-4 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">自己紹介・働き方</TabsTrigger>
          <TabsTrigger value="employment" className="px-4 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">所属・権限</TabsTrigger>
          <TabsTrigger value="documents" className="px-4 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">書類</TabsTrigger>
          <TabsTrigger value="ai" className="px-4 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">AI診断</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NavCard
              title="基本情報"
              icon="👤"
              description="氏名、住所、連絡先、振込口座など"
              onClick={() => setActiveTab('basic')}
            />
            <NavCard
              title="自己紹介・働き方"
              icon="📝"
              description="自己紹介文、業務経験、強み・弱み、価値観など"
              onClick={() => setActiveTab('about')}
            />
            <NavCard
              title="所属・権限"
              icon="🏢"
              description="施設、部署、役職、システムの操作権限など"
              onClick={() => setActiveTab('employment')}
            />
            <NavCard
              title="提出書類"
              icon="📄"
              description="誓約書、免許証、保険証などの提出状況"
              onClick={() => setActiveTab('documents')}
            />
            <NavCard
              title="AI診断"
              icon="🧠"
              description="特性分析、モチベーション傾向、適性診断"
              onClick={() => setActiveTab('ai')}
            />
          </div>
        </TabsContent>

        <TabsContent value="basic" className="mt-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base font-bold">本人情報</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <InfoRow label="氏名" value={`${employee.last_name} ${employee.first_name}`} />
                <InfoRow label="フリガナ" value={`${employee.last_name_kana} ${employee.first_name_kana}`} />
                <InfoRow label="生年月日" value={employee.birth_date} />
                <InfoRow label="性別" value={employee.gender === 'male' ? '男性' : employee.gender === 'female' ? '女性' : employee.gender === 'other' ? 'その他' : '-'} />
                <InfoRow label="郵便番号" value={employee.postal_code || '-'} />
                <InfoRow label="住所" value={employee.address || '-'} />
                <InfoRow label="電話番号" value={employee.phone || '-'} />
                <InfoRow label="メール" value={employee.email || '-'} />
                <Separator className="my-2 opacity-50" />
                <InfoRow label="入社日" value={employee.join_date} />
                <InfoRow label="勤続年数" value={employee.years_of_service != null ? `${employee.years_of_service}年` : '-'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base font-bold">振込先口座</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <InfoRow label="銀行名" value={employee.bank_name || '-'} />
                <InfoRow label={(employee.bank_name || '').includes('ゆうちょ') ? '記号' : '支店名'} value={employee.bank_branch_name || '-'} />
                {!(employee.bank_name || '').includes('ゆうちょ') && (
                  <InfoRow label="口座種別" value={employee.bank_account_type === 'ordinary' ? '普通' : employee.bank_account_type === 'current' ? '当座' : employee.bank_account_type === 'savings' ? '貯蓄' : '-'} />
                )}
                <InfoRow label={(employee.bank_name || '').includes('ゆうちょ') ? '番号' : '口座番号'} value={employee.bank_account_number || '-'} />
                <InfoRow label="口座名義" value={employee.bank_account_holder || '-'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base font-bold">緊急連絡先</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-[10px] font-bold text-diletto-gray-light uppercase mb-1">連絡先 1</p>
                  <InfoRow label="氏名" value={employee.emergency1_name || '-'} />
                  <InfoRow label="続柄" value={employee.emergency1_relationship || '-'} />
                  <InfoRow label="電話番号" value={employee.emergency1_phone || '-'} />
                  <InfoRow label="携帯" value={employee.emergency1_mobile || '-'} />
                </div>
                {employee.emergency2_name && (
                  <div className="pt-2 border-t border-diletto-gray/5">
                    <p className="text-[10px] font-bold text-diletto-gray-light uppercase mb-1">連絡先 2</p>
                    <InfoRow label="氏名" value={employee.emergency2_name} />
                    <InfoRow label="続柄" value={employee.emergency2_relationship || '-'} />
                    <InfoRow label="電話番号" value={employee.emergency2_phone || '-'} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base font-bold">身元保証人</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <InfoRow label="氏名" value={employee.guarantor_name || '-'} />
                <InfoRow label="続柄" value={employee.guarantor_relationship || '-'} />
                <InfoRow label="電話番号" value={employee.guarantor_phone || '-'} />
                <InfoRow label="住所" value={employee.guarantor_address || '-'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base font-bold">通勤・車両情報</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <InfoRow label="自家用車通勤" value={employee.has_car_commute ? 'あり' : 'なし'} />
                <InfoRow label="送迎ドライバー" value={employee.is_shuttle_driver ? 'あり' : 'なし'} />
                {employee.has_car_commute && (
                  <div className="pt-2 mt-2 border-t border-diletto-gray/5 space-y-1.5">
                    <InfoRow label="車種" value={employee.car_model || '-'} />
                    <InfoRow label="ナンバー" value={employee.car_plate_number || '-'} />
                    <InfoRow label="保険会社" value={employee.insurance_company || '-'} />
                    <InfoRow label="通勤距離" value={employee.commute_distance ? `${employee.commute_distance}km` : '-'} />
                    <InfoRow label="免許番号" value={employee.license_number || '-'} />
                    <InfoRow label="免許期限" value={employee.license_expiry || '-'} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="about" className="mt-6 space-y-6">
          <Card>
            <CardHeader className="border-b border-diletto-gray/5">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <span>📝</span> 自己紹介・プロフィール
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-8">
              <div>
                <Label className="text-xs text-diletto-gray-light font-bold mb-2 block">自己紹介</Label>
                <div className="p-4 rounded-xl bg-diletto-gray/5 border border-diletto-gray/5 text-sm whitespace-pre-wrap leading-relaxed shadow-inner">
                  {employee.self_introduction || <span className="text-diletto-gray-light italic">未入力</span>}
                </div>
              </div>

              <div className="grid gap-8 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-diletto-gray-light font-bold mb-2 block">現在の業務内容</Label>
                  <p className="text-sm font-medium pl-1">{employee.current_duties || '未設定'}</p>
                </div>
                <div>
                  <Label className="text-xs text-diletto-gray-light font-bold mb-2 block">過去の経験・職歴</Label>
                  <p className="text-sm font-medium pl-1">{employee.past_duties || '未設定'}</p>
                </div>
              </div>

              <Separator className="opacity-50" />

              <div className="grid gap-8 sm:grid-cols-3">
                <div>
                  <Label className="text-xs text-diletto-gray-light font-bold mb-2 block">保有資格</Label>
                  <p className="text-sm font-medium pl-1">
                    {Array.isArray(employee.qualifications) && employee.qualifications.length > 0
                      ? employee.qualifications.join('、')
                      : '-'}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-diletto-gray-light font-bold mb-2 block">最終学歴・前職</Label>
                  <p className="text-sm font-medium pl-1">{employee.previous_employer || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-diletto-gray-light font-bold mb-2 block">雇用区分・区分</Label>
                  <p className="text-sm font-medium pl-1">{employee.job_type || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-diletto-gray/5">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <span>🤝</span> 働き方・コミュニケーション傾向
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-8">
              <div className="grid gap-8 sm:grid-cols-2">
                <div className="space-y-4">
                  <Label className="text-xs text-diletto-ink font-bold border-l-2 border-diletto-blue pl-2 mb-2 block">働き方の傾向</Label>
                  <div className="space-y-1.5">
                    <InfoRow label="チーム重視" value={WORK_STYLE_LABELS[employee.work_style_solo_vs_team || ''] || '-'} />
                    <InfoRow label="自律性" value={WORK_STYLE_LABELS[employee.work_style_clear_vs_autonomy || ''] || '-'} />
                    <InfoRow label="変化への対応" value={WORK_STYLE_LABELS[employee.work_style_stable_vs_change || ''] || '-'} />
                    <InfoRow label="思考・行動" value={WORK_STYLE_LABELS[employee.work_style_think_vs_act || ''] || '-'} />
                  </div>
                </div>
                <div className="space-y-4">
                  <Label className="text-xs text-diletto-ink font-bold border-l-2 border-diletto-green pl-2 mb-2 block">コミュニケーション</Label>
                  <div className="space-y-1.5">
                    <InfoRow label="結論・背景" value={COMM_LABELS[employee.comm_conclusion_vs_context || ''] || '-'} />
                    <InfoRow label="相談タイミング" value={COMM_LABELS[employee.comm_consult_timing || ''] || '-'} />
                    <InfoRow label="フィードバック" value={COMM_LABELS[employee.comm_feedback_preference || ''] || '-'} />
                    <InfoRow label="連絡手段" value={COMM_LABELS[employee.comm_channel_preference || ''] || '-'} />
                  </div>
                </div>
              </div>

              <Separator className="opacity-50" />

              <div className="grid gap-8 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-diletto-ink font-bold mb-3 block">強み</Label>
                  <div className="flex flex-wrap gap-2">
                    {[employee.strength_1, employee.strength_2, employee.strength_3].filter(Boolean).length > 0 ? (
                      [employee.strength_1, employee.strength_2, employee.strength_3].filter(Boolean).map((s, i) => (
                        <Badge key={i} variant="outline" className="bg-diletto-blue/5 text-diletto-blue border-diletto-blue/20 rounded-lg px-3 py-1 font-bold">{s}</Badge>
                      ))
                    ) : (<span className="text-sm text-diletto-gray-light">-</span>)}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-diletto-ink font-bold mb-3 block">弱み・課題</Label>
                  <div className="flex flex-wrap gap-2">
                    {[employee.weakness_1, employee.weakness_2, employee.weakness_3].filter(Boolean).length > 0 ? (
                      [employee.weakness_1, employee.weakness_2, employee.weakness_3].filter(Boolean).map((w, i) => (
                        <Badge key={i} variant="outline" className="bg-diletto-red/5 text-diletto-red border-diletto-red/20 rounded-lg px-3 py-1 font-bold">{w}</Badge>
                      ))
                    ) : (<span className="text-sm text-diletto-gray-light">-</span>)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employment" className="mt-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base font-bold">所属設定</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {/* 施設 */}
                <div className={`relative overflow-hidden rounded-xl border transition-all duration-300 ${facilityEditing ? 'border-diletto-blue ring-4 ring-diletto-blue/5 shadow-md' : 'border-diletto-gray/10 bg-white/50 hover:bg-white hover:shadow-sm'}`}>
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-diletto-gray uppercase tracking-wider">所属施設</span>
                      {!facilityEditing && (
                        <button type="button" onClick={() => setFacilityEditing(true)} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-diletto-blue/5 text-diletto-blue hover:bg-diletto-blue hover:text-white transition-all">変更</button>
                      )}
                    </div>
                    {facilityEditing ? (
                      <div className="space-y-2">
                        <select title="所属施設を選択" value={facilityDraftId} onChange={(e) => setFacilityDraftId(e.target.value)} className="w-full h-9 rounded-lg border border-diletto-gray/20 bg-white px-2 text-xs focus:ring-2 focus:ring-diletto-blue/20 outline-none" autoFocus>
                          <option value="">（未所属）</option>
                          {allFacilities.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                        </select>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1 h-8 text-[11px]" onClick={handleSaveFacility} disabled={facilitySaving}>{facilitySaving ? '...' : '保存'}</Button>
                          <Button size="sm" variant="ghost" className="flex-1 h-8 text-[11px]" onClick={() => { setFacilityEditing(false); setFacilityDraftId(employee.facility_id || ''); }} disabled={facilitySaving}>キャンセル</Button>
                        </div>
                      </div>
                    ) : (
                      <p className={`text-sm pl-1 ${facilityName ? 'font-bold text-diletto-ink' : 'text-diletto-gray-light italic'}`}>{facilityName || '未所属'}</p>
                    )}
                  </div>
                </div>

                {/* 役職 */}
                <div className={`relative overflow-hidden rounded-xl border transition-all duration-300 ${posEditing ? 'border-diletto-blue ring-4 ring-diletto-blue/5 shadow-md' : 'border-diletto-gray/10 bg-white/50 hover:bg-white hover:shadow-sm'}`}>
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-diletto-gray uppercase tracking-wider">役職</span>
                      {!posEditing && (
                        <button type="button" onClick={() => setPosEditing(true)} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-diletto-ink/5 text-diletto-ink hover:bg-diletto-ink hover:text-white transition-all">変更</button>
                      )}
                    </div>
                    {posEditing ? (
                      <div className="space-y-2">
                        <select title="役職を選択" value={posDraftId} onChange={(e) => setPosDraftId(e.target.value)} className="w-full h-9 rounded-lg border border-diletto-gray/20 bg-white px-2 text-xs focus:ring-2 focus:ring-diletto-blue/20 outline-none">
                          <option value="">（役職なし）</option>
                          {allPositions.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                        </select>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1 h-8 text-[11px]" onClick={handleSavePosition} disabled={posSaving}>{posSaving ? '...' : '保存'}</Button>
                          <Button size="sm" variant="ghost" className="flex-1 h-8 text-[11px]" onClick={() => { setPosEditing(false); setPosDraftId(employee.position_id || ''); }} disabled={posSaving}>キャンセル</Button>
                        </div>
                      </div>
                    ) : (
                      <p className={`text-sm pl-1 ${employee.position_id ? 'font-bold text-diletto-ink' : 'text-diletto-gray-light italic'}`}>
                        {allPositions.find(p => p.id === employee.position_id)?.name || '役職なし'}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base font-bold">システム権限・ステータス</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[10px] text-diletto-gray-light font-bold uppercase">権限ロール</Label>
                  <select
                    title="システムロールを選択"
                    className="flex h-10 w-full rounded-xl border border-diletto-gray/20 bg-white px-3 py-1 text-sm focus:ring-2 focus:ring-diletto-blue/20 outline-none"
                    value={roleValue}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    disabled={roleSaving}
                  >
                    {EMPLOYEE_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>

                {roleValue === 'manager' && (
                  <div className="pt-4 border-t border-diletto-gray/5">
                    <Label className="text-[10px] text-diletto-gray-light font-bold uppercase">管理担当施設</Label>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {/* 本人の所属施設を自動管理枠で表示 (グレー) */}
                      {employee.facility_id && (
                        <Badge variant="secondary" className="bg-diletto-gray/5 text-diletto-gray-light border-none rounded-md px-2 py-0.5 flex items-center gap-1 opacity-70">
                          {allFacilitiesMaster.find(f => f.id === employee.facility_id)?.name || '不明'}
                          <span className="text-[9px] font-normal leading-none">(所属)</span>
                        </Badge>
                      )}
                      {/* 追加設定された担当施設 */}
                      {mgrFacilities.map((fId) => (
                        <Badge key={fId} variant="secondary" className="bg-diletto-blue/5 text-diletto-blue border-none rounded-md px-2 py-0.5 flex items-center gap-1">
                          {allFacilitiesMaster.find(f => f.id === fId)?.name || '不明'}
                          <button onClick={() => removeFacility(fId)} className="hover:text-diletto-red">×</button>
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-1">
                      <select title="担当施設を追加" className="flex-1 h-8 rounded-lg border border-diletto-gray/20 text-xs px-2" value={newFacility} onChange={(e) => setNewFacility(e.target.value)}>
                        <option value="">追加する施設...</option>
                        {allFacilitiesMaster.filter((f) => !mgrFacilities.includes(f.id) && f.id !== employee.facility_id).map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                      </select>
                      <Button size="sm" className="h-8 text-[10px]" onClick={() => addFacility(newFacility)} disabled={!newFacility}>追加</Button>
                    </div>

                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <div className="mb-4">
            <EmployeeImagesCard
              employeeId={employee.id}
              tenantId={employee.tenant_id}
              licensePath={employee.license_image_path}
              licenseBackPath={employee.license_image_back_path}
              commuteRoutePath={employee.commute_route_image_path}
              customFields={employee.custom_fields}
              customFieldDefs={imageFieldDefs}
            />
          </div>
          {docItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-diletto-gray-light">
                この社員に対象の書類テンプレートがありません
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {docItems.some(({ submission }) => submission?.status === 'submitted' || submission?.status === 'approved') && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkDownload}
                    disabled={bulkDownloading}
                  >
                    {bulkDownloading ? 'ZIP作成中...' : '提出済を一括ZIPダウンロード'}
                  </Button>
                </div>
              )}
              {docItems.map(({ template, submission }) => {
                const statusLabel = !submission ? '未着手'
                  : submission.status === 'draft' ? '下書き'
                    : submission.status === 'submitted' ? '提出済'
                      : submission.status === 'approved' ? '承認済' : submission.status;
                const statusClass = !submission ? 'bg-diletto-gray/5 text-diletto-gray-light border-diletto-gray/10'
                  : submission.status === 'draft' ? 'bg-diletto-gold/[0.08] text-diletto-gold border-diletto-gold/20'
                    : submission.status === 'submitted' ? 'bg-diletto-green/10 text-diletto-green border-diletto-green/20'
                      : 'bg-diletto-blue/[0.07] text-diletto-blue border-diletto-blue/20';
                const canDownload = submission && (submission.status === 'submitted' || submission.status === 'approved') && !!template.pdf_storage_path;
                return (
                  <Card key={template.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium text-sm">{template.name}</p>
                        {submission?.submitted_at && (
                          <p className="text-xs text-diletto-gray-light mt-1">
                            提出日: {new Date(submission.submitted_at).toLocaleDateString('ja-JP')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {canDownload && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadPdf(employee.id, template.id, template.name)}
                            disabled={downloadingId === template.id}
                          >
                            {downloadingId === template.id ? '生成中...' : 'ダウンロード'}
                          </Button>
                        )}
                        <Badge className={statusClass}>{statusLabel}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <AIDiagnosisPanel employeeId={employee.id} tenantId={employee.tenant_id} />
        </TabsContent>
      </Tabs>

      {/* 退職ダイアログ */}
      <Dialog open={retireOpen} onOpenChange={setRetireOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退職処理</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-diletto-gray">
              {employee.last_name} {employee.first_name} さんを退職扱いにします。
            </p>
            <div className="space-y-2">
              <Label>退職日</Label>
              <Input
                type="date"
                value={retireDate}
                onChange={(e) => setRetireDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>退職理由（任意）</Label>
              <Input
                value={retireReason}
                onChange={(e) => setRetireReason(e.target.value)}
                placeholder="自己都合 など"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetireOpen(false)}>キャンセル</Button>
            <Button
              onClick={handleRetire}
              disabled={retireLoading}
              className="bg-diletto-red hover:bg-[#7a2828] text-white"
            >
              {retireLoading ? '処理中...' : '退職処理を実行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5 border-b border-diletto-gray/5 last:border-b-0">
      <span className="text-diletto-gray-light w-24 shrink-0 text-xs">{label}</span>
      <span className="text-[#111] text-sm">{value}</span>
    </div>
  );
}

function NavCard({ title, icon, description, onClick }: { title: string; icon: string; description: string; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="cursor-pointer hover:border-diletto-blue/50 hover:shadow-md transition-all group overflow-hidden border-diletto-gray/10">
      <CardContent className="p-5 flex items-center gap-4">
        <div className="h-12 w-12 rounded-2xl bg-diletto-blue/5 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-diletto-ink text-sm">{title}</h3>
          <p className="text-[10px] text-diletto-gray truncate">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
