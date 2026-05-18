'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { InviteUrlDialog } from '@/components/admin/InviteUrlDialog';
import type { Employee } from '@/lib/types';

interface Props {
  employees: Employee[];
  facilityMap?: Map<string, string>;
}

export function EmployeeTable({ employees, facilityMap }: Props) {
  const [resending, setResending] = useState<string | null>(null);
  /* Resend daily limit 等で送信失敗した場合、API が返してくる inviteLink を
     ダイアログで表示して手動配布できるようにする。 */
  const [pendingInviteLink, setPendingInviteLink] = useState<{ url: string; name: string } | null>(null);

  async function handleResendInvite(emp: Employee) {
    setResending(emp.id);
    const res = await fetch('/api/employees/resend-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: emp.id }),
    });
    const json = await res.json();
    setResending(null);

    if (!res.ok) {
      toast.error('再送信に失敗しました', { description: json.error });
      return;
    }

    if (json.warning) {
      toast.warning(json.warning);
    } else {
      toast.success(`${emp.last_name} ${emp.first_name}さんに招待メールを再送信しました`);
    }

    if (json.inviteLink) {
      setPendingInviteLink({ url: json.inviteLink, name: `${emp.last_name} ${emp.first_name}` });
    }
  }

  /** 初回ログイン未完了の判定: 招待済み かつ まだ誓約未確認 かつ admin以外 */
  function needsInviteResend(emp: Employee): boolean {
    return emp.role !== 'admin'
      && emp.invited_at !== null
      && emp.pledge_confirmed_at === null;
  }

  return (
    <div className="rounded-md border border-[rgba(0,0,0,0.1)] bg-white">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">社員番号</TableHead>
            <TableHead>氏名</TableHead>
            <TableHead>メール</TableHead>
            <TableHead className="w-28">施設</TableHead>
            <TableHead className="w-24">入社日</TableHead>
            <TableHead className="w-20">ステータス</TableHead>
            <TableHead className="w-24">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-24 text-center text-brand-gray-light">
                社員がまだ登録されていません
              </TableCell>
            </TableRow>
          ) : (
            employees.map((emp) => (
              <TableRow key={emp.id}>
                <TableCell className="font-mono text-xs">{emp.employee_number}</TableCell>
                <TableCell>
                  {/* 氏名 + role バッジ: バッジを行間で縦に揃えるため、氏名側に min-w を設定。
                      role バッジ: admin=紫 / manager=青（access-matrix 凡例と統一）。
                      共通: variant="outline" + text-[10px] + 同じ border-opacity / 同じ width。 */}
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/employees/${emp.id}`}
                      className="font-medium text-brand-blue hover:underline inline-block min-w-[9em]"
                    >
                      {emp.last_name} {emp.first_name}
                    </Link>
                    {emp.role === 'admin' && (
                      <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-600 w-[6.5em] justify-center whitespace-nowrap">管理者</Badge>
                    )}
                    {emp.role === 'manager' && (
                      <Badge variant="outline" className="text-[10px] border-brand-blue/30 text-brand-blue w-[6.5em] justify-center whitespace-nowrap">マネージャー</Badge>
                    )}
                    {emp.role === 'shift_manager' && (
                      <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600 w-[6.5em] justify-center whitespace-nowrap">シフト統括</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-brand-gray">{emp.email}</TableCell>
                <TableCell className="text-sm">
                  {emp.facility_id ? (facilityMap?.get(emp.facility_id) || '-') : '-'}
                </TableCell>
                <TableCell className="text-sm">{emp.join_date}</TableCell>
                <TableCell>
                  {emp.status === 'active' ? (
                    <Badge className="bg-brand-green/10 text-brand-green border-brand-green/20">
                      在籍
                    </Badge>
                  ) : (
                    <Badge className="bg-brand-red/[0.06] text-brand-red border-brand-red/15">
                      退職
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {needsInviteResend(emp) && (
                      <button
                        onClick={() => handleResendInvite(emp)}
                        disabled={resending === emp.id}
                        className="text-xs px-2 py-1 rounded-md border border-brand-blue/30 text-brand-blue hover:bg-brand-blue/5 transition-all disabled:opacity-50"
                      >
                        {resending === emp.id ? '送信中...' : '招待再送'}
                      </button>
                    )}
                    {emp.status === 'active' && (
                      <Link
                        href={`/admin/messages?to=${emp.id}`}
                        className="text-xs px-2 py-1 rounded-md border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all whitespace-nowrap"
                        title={`${emp.last_name} ${emp.first_name} さんに個別連絡`}
                      >
                        💬 個別連絡
                      </Link>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>

      <InviteUrlDialog
        open={!!pendingInviteLink}
        url={pendingInviteLink?.url ?? null}
        employeeName={pendingInviteLink?.name}
        onClose={() => setPendingInviteLink(null)}
      />
    </div>
  );
}
