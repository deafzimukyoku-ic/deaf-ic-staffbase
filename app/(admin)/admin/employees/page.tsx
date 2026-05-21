'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmployeeTable } from '@/components/admin/EmployeeTable';
import { BulkIssueCompanyDocumentsButton } from '@/components/admin/BulkIssueCompanyDocumentsButton';
import type { Employee, Facility } from '@/lib/types';

type RoleFilter = 'all' | 'admin' | 'manager' | 'employee';
type StatusFilter = 'all' | 'active' | 'retired';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);

  // フィルタ状態
  const [search, setSearch] = useState('');
  const [facilityFilter, setFacilityFilter] = useState<string>('all'); // 'all' | '__none__' | facility.id
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

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

      if (!me) return;

      const [empRes, facRes] = await Promise.all([
        supabase.from('employees').select('*').eq('tenant_id', me.tenant_id).order('employee_number'),
        supabase.from('facilities').select('id, tenant_id, name, address, created_at').eq('tenant_id', me.tenant_id).order('display_order', { ascending: true }).order('created_at', { ascending: true }),
      ]);

      setEmployees((empRes.data as Employee[]) || []);
      setFacilities((facRes.data as Facility[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const facilityMap = useMemo(() => new Map(facilities.map((f) => [f.id, f.name])), [facilities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      // シフト統括 (shift_manager) は別セクション表示。通常社員テーブルからは除外
      if (e.role === 'shift_manager') return false;
      // 施設
      if (facilityFilter === '__none__') {
        if (e.facility_id) return false;
      } else if (facilityFilter !== 'all') {
        if (e.facility_id !== facilityFilter) return false;
      }
      // ロール
      if (roleFilter !== 'all') {
        if (roleFilter === 'admin' && !(e.role === 'admin')) return false;
        if (roleFilter !== 'admin' && e.role !== roleFilter) return false;
      }
      // ステータス
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      // テキスト検索: 氏名・社員番号・メール
      if (q) {
        const hay = `${e.last_name}${e.first_name}${e.last_name_kana || ''}${e.first_name_kana || ''}${e.employee_number}${e.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, search, facilityFilter, roleFilter, statusFilter]);

  /* シフト統括 (shift_manager) 専用アカウント: 通常社員テーブルとは別セクションで表示。
     検索ボックスと在籍状況フィルタのみ適用 (施設・ロールフィルタは通常社員テーブル専用)。 */
  const shiftManagerList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (e.role !== 'shift_manager') return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (q) {
        const hay = `${e.last_name}${e.first_name}${e.last_name_kana || ''}${e.first_name_kana || ''}${e.employee_number}${e.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, search, statusFilter]);

  /* 「社員数」分母: shift_manager を除いた通常社員の総数 */
  const normalTotal = useMemo(() => employees.filter((e) => e.role !== 'shift_manager').length, [employees]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold whitespace-nowrap">社員管理</h1>
          <p className="text-sm text-brand-gray mt-1">
            {loading ? '読み込み中...' : `${filtered.length} / ${normalTotal}名`}
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <Link href="/admin/access-matrix">
            <Button variant="outline" className="gap-1 whitespace-nowrap">
              <span>🔐</span> アプリ権限
            </Button>
          </Link>
          <Link href="/admin/team-diagnosis">
            <Button variant="outline" className="gap-1 whitespace-nowrap">
              <span>🔍</span> チーム診断
            </Button>
          </Link>
          <BulkIssueCompanyDocumentsButton />
          <Link href="/admin/employees/new">
            <Button className="whitespace-nowrap">+ 社員を追加</Button>
          </Link>
        </div>
      </div>

      {!loading && (
        <div className="mb-4 rounded-lg border border-brand-gray/15 bg-white p-3 space-y-3">
          <Input
            placeholder="氏名・社員番号・メールで検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <label className="space-y-1">
              <span className="text-xs text-brand-gray-light">施設</span>
              <select
                value={facilityFilter}
                onChange={(e) => setFacilityFilter(e.target.value)}
                className="w-full h-9 rounded-md border border-brand-gray/20 bg-white px-2"
              >
                <option value="all">すべての施設</option>
                <option value="__none__">未所属</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-brand-gray-light">ロール</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
                className="w-full h-9 rounded-md border border-brand-gray/20 bg-white px-2"
              >
                <option value="all">すべて</option>
                <option value="admin">管理者</option>
                <option value="manager">マネージャー</option>
                <option value="employee">一般社員</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-brand-gray-light">在籍状況</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full h-9 rounded-md border border-brand-gray/20 bg-white px-2"
              >
                <option value="all">すべて</option>
                <option value="active">在籍</option>
                <option value="retired">退職</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {!loading && <EmployeeTable employees={filtered} facilityMap={facilityMap} />}

      {/* シフト統括アカウント: 通常社員と別エリア。shift_manager が 1 件以上のときのみ表示。 */}
      {!loading && shiftManagerList.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold">シフト統括アカウント</h2>
          <p className="text-sm text-brand-gray mt-1 mb-3">
            シフト・送迎専用のアカウントです。社員数には含まれません。
          </p>
          <EmployeeTable employees={shiftManagerList} facilityMap={facilityMap} />
        </div>
      )}
    </div>
  );
}
