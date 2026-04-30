'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

/**
 * /admin/access-matrix
 *
 * 管理者・マネージャーの「施設アクセス権限」を 1 ページで一覧・編集する。
 * 行: admin / manager の active 社員のみ
 * 列: 従業員番号 / 名前 / ロール / 施設 1 / 施設 2 / ...
 *
 * セル:
 *   - ● = 所属施設 (employees.facility_id)。クリック不可（社員詳細ページで管理）。
 *         admin 行は全施設に「●」相当のフルアクセスを持つので、所属以外も
 *         グレーの ★ で「全アクセス」として表示する。
 *   - ○ = 担当施設 (manager_facilities)。manager のみ。クリックで担当外しの確認モーダル。
 *   - × = 未割当 (manager のみ)。クリックで担当追加の確認モーダル。
 *
 * ロール変更: <select> + 確認モーダル。employee に変更すると行は一覧から消える。
 *
 * 「+管理者・マネージャーを追加」ボタン: 簡易招待モーダル（このページ完結）。
 */

type FacilityLite = { id: string; name: string };
type EmpRow = {
  id: string;
  employee_number: string;
  last_name: string;
  first_name: string;
  email: string | null;
  role: 'admin' | 'manager' | 'shift_manager' | 'employee';
  facility_id: string | null;
  /** manager_facilities に紐付く facility_id 集合 */
  managedFacilityIds: Set<string>;
};

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者',
  manager: 'マネージャー',
  shift_manager: 'シフト統括',
  employee: '一般社員',
};

export default function AccessMatrixPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<FacilityLite[]>([]);
  const [employees, setEmployees] = useState<EmpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* ロール変更モーダル */
  const [roleChangeTarget, setRoleChangeTarget] = useState<{
    emp: EmpRow;
    next: 'admin' | 'manager' | 'shift_manager' | 'employee';
  } | null>(null);

  /* セル変更モーダル */
  const [cellChangeTarget, setCellChangeTarget] = useState<{
    emp: EmpRow;
    facility: FacilityLite;
    action: 'add' | 'remove';
  } | null>(null);

  /* 追加モーダル */
  const [addOpen, setAddOpen] = useState(false);

  const supabase = useState(() => createClient())[0];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('未認証');
      const { data: me } = await supabase
        .from('employees')
        .select('tenant_id, role')
        .eq('auth_user_id', user.id)
        .single();
      if (!me || me.role !== 'admin') throw new Error('管理者権限が必要です');
      setTenantId(me.tenant_id);

      const [facRes, empRes, mfRes] = await Promise.all([
        supabase.from('facilities').select('id, name').eq('tenant_id', me.tenant_id).order('display_order', { ascending: true }).order('created_at', { ascending: true }),
        supabase
          .from('employees')
          .select('id, employee_number, last_name, first_name, email, role, facility_id')
          .eq('tenant_id', me.tenant_id)
          .eq('status', 'active')
          .in('role', ['admin', 'manager', 'shift_manager'])
          .order('employee_number'),
        supabase.from('manager_facilities').select('employee_id, facility_id'),
      ]);

      setFacilities((facRes.data ?? []) as FacilityLite[]);

      const mfMap = new Map<string, Set<string>>();
      for (const r of (mfRes.data ?? []) as { employee_id: string; facility_id: string }[]) {
        let s = mfMap.get(r.employee_id);
        if (!s) {
          s = new Set();
          mfMap.set(r.employee_id, s);
        }
        s.add(r.facility_id);
      }

      const empRows: EmpRow[] = (empRes.data ?? []).map((e: Record<string, unknown>) => ({
        id: e.id as string,
        employee_number: (e.employee_number as string) ?? '',
        last_name: (e.last_name as string) ?? '',
        first_name: (e.first_name as string) ?? '',
        email: (e.email as string | null) ?? null,
        role: (e.role as 'admin' | 'manager' | 'shift_manager' | 'employee') ?? 'employee',
        facility_id: (e.facility_id as string | null) ?? null,
        managedFacilityIds: mfMap.get(e.id as string) ?? new Set(),
      }));
      setEmployees(empRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  /* ── ロール変更 ── */
  const handleRoleChangeConfirm = async () => {
    if (!roleChangeTarget) return;
    const { emp, next } = roleChangeTarget;
    const { error: upErr } = await supabase.from('employees').update({ role: next }).eq('id', emp.id);
    if (upErr) {
      toast.error('ロール変更に失敗しました', { description: upErr.message });
      return;
    }
    /* employee に降格時は manager_facilities を全削除（所属以外のアクセスを失う） */
    if (next === 'employee') {
      await supabase.from('manager_facilities').delete().eq('employee_id', emp.id);
    }
    toast.success(`${emp.last_name} ${emp.first_name} さんのロールを「${ROLE_LABELS[next]}」に変更しました`);
    setRoleChangeTarget(null);
    void fetchAll();
  };

  /* ── 担当施設トグル ── */
  const handleCellChangeConfirm = async () => {
    if (!cellChangeTarget) return;
    const { emp, facility, action } = cellChangeTarget;
    if (action === 'add') {
      const { error: insErr } = await supabase
        .from('manager_facilities')
        .insert({ employee_id: emp.id, facility_id: facility.id });
      if (insErr) {
        toast.error('担当追加に失敗しました', { description: insErr.message });
        return;
      }
      toast.success(`${emp.last_name} ${emp.first_name} さんを「${facility.name}」の担当に追加しました`);
    } else {
      const { error: delErr } = await supabase
        .from('manager_facilities')
        .delete()
        .eq('employee_id', emp.id)
        .eq('facility_id', facility.id);
      if (delErr) {
        toast.error('担当外しに失敗しました', { description: delErr.message });
        return;
      }
      toast.success(`${emp.last_name} ${emp.first_name} さんを「${facility.name}」の担当から外しました`);
    }
    setCellChangeTarget(null);
    void fetchAll();
  };

  /* ── セル状態判定 ── */
  type CellState = 'belong' | 'managed' | 'admin-all' | 'none';
  function getCellState(emp: EmpRow, facilityId: string): CellState {
    if (emp.facility_id === facilityId) return 'belong'; /* ● 所属 */
    if (emp.role === 'admin') return 'admin-all'; /* admin は全施設アクセス */
    if (emp.managedFacilityIds.has(facilityId)) return 'managed'; /* ○ 担当 */
    return 'none'; /* × */
  }

  return (
    <div className="pb-12">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">権限マトリクス</h1>
          <p className="text-xs text-diletto-gray-light mt-1">
            管理者・マネージャーの施設アクセス権限を一覧編集できます。所属施設は社員詳細ページから変更してください。
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>+ 管理者・マネージャーを追加</Button>
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-2 rounded text-sm"
          style={{ background: 'var(--red-pale)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* 凡例: 同じ〇マークで色分け（マークの種類で区別しない） */}
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-diletto-gray items-center">
        <span className="inline-flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'var(--ink-2, #1f2937)', color: '#fff' }}>所属</span>
          所属施設（クリック不可・社員詳細で変更）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-base font-bold" style={{ color: '#a855f7' }}>○</span>
          管理者の全施設アクセス
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-base font-bold" style={{ color: '#2563eb' }}>○</span>
          マネージャーの担当施設（クリックで外す）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-base font-bold" style={{ color: '#9ca3af' }}>×</span>
          未割当（クリックで追加）
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-diletto-gray-light py-10 text-center">読み込み中...</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-diletto-gray/15">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-diletto-beige/50 border-b border-diletto-gray/15">
                <th className="text-left px-3 py-2 text-xs font-bold text-diletto-gray-light uppercase">
                  従業員番号
                </th>
                <th className="text-left px-3 py-2 text-xs font-bold text-diletto-gray-light uppercase">
                  名前
                </th>
                <th className="text-left px-3 py-2 text-xs font-bold text-diletto-gray-light uppercase">
                  ロール
                </th>
                {facilities.map((f) => (
                  <th
                    key={f.id}
                    className="text-center px-3 py-2 text-xs font-bold text-diletto-gray-light uppercase whitespace-nowrap"
                  >
                    {f.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 && (
                <tr>
                  <td
                    colSpan={3 + facilities.length}
                    className="text-center py-10 text-diletto-gray-light"
                  >
                    管理者・マネージャーが登録されていません。
                  </td>
                </tr>
              )}
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-diletto-gray/10 hover:bg-diletto-beige/30">
                  <td className="px-3 py-2 font-mono text-xs text-diletto-gray">
                    {emp.employee_number}
                  </td>
                  <td className="px-3 py-2 font-bold whitespace-nowrap">
                    <Link
                      href={`/admin/employees/${emp.id}`}
                      className="text-diletto-blue hover:underline"
                      title="社員詳細を開く"
                    >
                      {emp.last_name} {emp.first_name}
                    </Link>
                    {emp.email && (
                      <div className="text-[10px] text-diletto-gray-light font-normal">
                        {emp.email}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={emp.role}
                      onChange={(e) => {
                        const next = e.target.value as 'admin' | 'manager' | 'shift_manager' | 'employee';
                        if (next === emp.role) return;
                        setRoleChangeTarget({ emp, next });
                      }}
                      className="h-7 rounded border border-diletto-gray/20 bg-white px-2 text-xs font-bold"
                      title="ロール変更"
                    >
                      <option value="admin">管理者</option>
                      <option value="manager">マネージャー</option>
                      <option value="shift_manager">シフト統括</option>
                      <option value="employee">一般社員</option>
                    </select>
                  </td>
                  {facilities.map((f) => {
                    const state = getCellState(emp, f.id);
                    /* 所属は【所属】テキストバッジ、それ以外は同じ〇で色分け（admin=紫 / manager=青 / 未割当=グレー×） */
                    let clickable = false;
                    let action: 'add' | 'remove' | null = null;
                    if (state === 'managed') {
                      clickable = true;
                      action = 'remove';
                    } else if (state === 'none' && emp.role === 'manager') {
                      clickable = true;
                      action = 'add';
                    }
                    const titleText =
                      state === 'belong'
                        ? '所属施設（社員詳細で変更）'
                        : state === 'admin-all'
                          ? '管理者: 全施設アクセス'
                          : state === 'managed'
                            ? 'クリックで担当から外す'
                            : emp.role === 'manager'
                              ? 'クリックで担当に追加'
                              : '管理者は全施設アクセス済';
                    return (
                      <td
                        key={f.id}
                        className={`text-center px-3 py-2 ${clickable ? 'cursor-pointer hover:bg-diletto-blue/5' : 'cursor-default'}`}
                        onClick={() => {
                          if (!clickable || !action) return;
                          setCellChangeTarget({ emp, facility: f, action });
                        }}
                        title={titleText}
                      >
                        {state === 'belong' ? (
                          <span
                            className="inline-block px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap"
                            style={{ background: 'var(--ink-2, #1f2937)', color: '#fff' }}
                          >
                            所属
                          </span>
                        ) : state === 'admin-all' ? (
                          <span className="text-xl font-bold" style={{ color: '#a855f7' }}>○</span>
                        ) : state === 'managed' ? (
                          <span className="text-xl font-bold" style={{ color: '#2563eb' }}>○</span>
                        ) : (
                          <span className="text-xl font-bold" style={{ color: '#9ca3af' }}>×</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ロール変更確認モーダル */}
      <Dialog open={!!roleChangeTarget} onOpenChange={(o) => !o && setRoleChangeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ロール変更の確認</DialogTitle>
          </DialogHeader>
          {roleChangeTarget && (
            <p className="text-sm">
              <b>
                {roleChangeTarget.emp.last_name} {roleChangeTarget.emp.first_name}
              </b>{' '}
              さんのロールを{' '}
              <b>「{ROLE_LABELS[roleChangeTarget.emp.role]}」</b> から{' '}
              <b className="text-diletto-blue">「{ROLE_LABELS[roleChangeTarget.next]}」</b>{' '}
              に変更しますか？
              {roleChangeTarget.next === 'employee' && (
                <span className="block mt-2 text-xs text-diletto-red">
                  ※ 一般社員に降格すると、このページの一覧から消え、担当施設の設定も全て解除されます。
                </span>
              )}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRoleChangeTarget(null)}>
              キャンセル
            </Button>
            <Button onClick={handleRoleChangeConfirm}>変更する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* セル変更確認モーダル */}
      <Dialog open={!!cellChangeTarget} onOpenChange={(o) => !o && setCellChangeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cellChangeTarget?.action === 'add' ? '担当施設に追加' : '担当施設から外す'}
            </DialogTitle>
          </DialogHeader>
          {cellChangeTarget && (
            <p className="text-sm">
              <b>
                {cellChangeTarget.emp.last_name} {cellChangeTarget.emp.first_name}
              </b>{' '}
              さんを{' '}
              <b className="text-diletto-blue">「{cellChangeTarget.facility.name}」</b> の担当
              {cellChangeTarget.action === 'add' ? 'に追加' : 'から外'}しますか？
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCellChangeTarget(null)}>
              キャンセル
            </Button>
            <Button onClick={handleCellChangeConfirm}>
              {cellChangeTarget?.action === 'add' ? '追加する' : '外す'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 追加モーダル */}
      <AddManagerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilities={facilities}
        onAdded={() => {
          setAddOpen(false);
          void fetchAll();
        }}
      />
    </div>
  );
}

/* ===== 追加モーダル ===== */
function AddManagerDialog({
  open,
  onOpenChange,
  facilities,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  facilities: FacilityLite[];
  onAdded: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    email: '',
    employee_number: '',
    last_name: '',
    first_name: '',
    role: 'manager' as 'admin' | 'manager' | 'shift_manager',
    facility_id: '',
    manager_facility_ids: [] as string[],
  });

  /* open するたびにリセット */
  useEffect(() => {
    if (open) {
      setForm({
        email: '',
        employee_number: '',
        last_name: '',
        first_name: '',
        role: 'manager',
        facility_id: facilities[0]?.id ?? '',
        manager_facility_ids: [],
      });
    }
  }, [open, facilities]);

  const handleSubmit = async () => {
    if (!form.email || !form.employee_number || !form.last_name || !form.first_name) {
      toast.error('必須項目を入力してください');
      return;
    }
    if (form.role === 'manager' && !form.facility_id) {
      toast.error('マネージャーは所属施設の指定が必要です');
      return;
    }
    if (form.role === 'shift_manager' && !form.facility_id) {
      toast.error('シフト統括は所属施設の指定が必要です');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/employees/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          employee_number: form.employee_number,
          last_name: form.last_name,
          first_name: form.first_name,
          last_name_kana: '',
          first_name_kana: '',
          join_date: new Date().toISOString().slice(0, 10),
          has_car_commute: false,
          is_shuttle_driver: false,
          facility_id: form.facility_id || null,
          role: form.role,
          manager_facility_ids: form.role === 'manager' ? form.manager_facility_ids : [],
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error('追加に失敗しました', { description: result.detail || result.error });
        return;
      }
      toast.success(`${form.last_name} ${form.first_name} さんを招待しました`);
      onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  const toggleManagerFacility = (id: string) => {
    setForm((prev) => {
      const exists = prev.manager_facility_ids.includes(id);
      return {
        ...prev,
        manager_facility_ids: exists
          ? prev.manager_facility_ids.filter((x) => x !== id)
          : [...prev.manager_facility_ids, id],
      };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>管理者・マネージャーを追加</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">ロール *</Label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'manager' | 'shift_manager' })}
              className="w-full h-9 rounded-lg border border-diletto-gray/20 bg-white px-2 text-sm mt-1"
            >
              <option value="manager">マネージャー</option>
              <option value="admin">管理者</option>
              <option value="shift_manager">シフト統括（事業所共用 / 送迎・シフト専用）</option>
            </select>
            {form.role === 'shift_manager' && (
              <p className="text-[10px] text-diletto-gray-light mt-1 leading-tight">
                ※ 事業所の操作端末用アカウント。シフト・送迎・日次出力などのみ操作可能。書類・お知らせ等にはアクセス不可。
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">従業員番号 *</Label>
              <Input
                value={form.employee_number}
                onChange={(e) => setForm({ ...form, employee_number: e.target.value })}
                placeholder="001"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">メール *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="user@example.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">姓 *</Label>
              <Input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">名 *</Label>
              <Input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">所属施設 {form.role === 'manager' ? '*' : ''}</Label>
            <select
              value={form.facility_id}
              onChange={(e) => setForm({ ...form, facility_id: e.target.value })}
              className="w-full h-9 rounded-lg border border-diletto-gray/20 bg-white px-2 text-sm mt-1"
            >
              <option value="">（未設定）</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {form.role === 'manager' && (
            <div>
              <Label className="text-xs">追加担当施設（任意）</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {facilities
                  .filter((f) => f.id !== form.facility_id)
                  .map((f) => {
                    const checked = form.manager_facility_ids.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleManagerFacility(f.id)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          checked
                            ? 'bg-diletto-blue text-white border-diletto-blue'
                            : 'bg-white text-diletto-gray border-diletto-gray/20 hover:bg-diletto-beige'
                        }`}
                      >
                        {f.name} {checked ? '✓' : ''}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '追加中...' : '招待を送信'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
