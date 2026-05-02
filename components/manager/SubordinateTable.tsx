'use client';

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

interface SubordinateRow {
  id: string;
  employee_number: string;
  last_name: string;
  first_name: string;
  position: string | null;
  status: string;
  join_date: string;
}

interface Props {
  employees: SubordinateRow[];
}

export function SubordinateTable({ employees }: Props) {
  return (
    <div className="rounded-md border border-[rgba(0,0,0,0.1)] bg-white">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">社員番号</TableHead>
              <TableHead>氏名</TableHead>
              <TableHead className="w-28">役職</TableHead>
              <TableHead className="w-24">入社日</TableHead>
              <TableHead className="w-20">ステータス</TableHead>
              <TableHead className="w-32">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-diletto-gray-light">
                  担当施設に所属する社員がいません
                </TableCell>
              </TableRow>
            ) : (
              employees.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell className="font-mono text-xs">{emp.employee_number}</TableCell>
                  <TableCell>
                    <Link
                      href={`/mgr/subordinates/${emp.id}`}
                      className="font-medium text-diletto-blue hover:underline"
                    >
                      {emp.last_name} {emp.first_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{emp.position || '-'}</TableCell>
                  <TableCell className="text-sm">{emp.join_date}</TableCell>
                  <TableCell>
                    {emp.status === 'active' ? (
                      <Badge className="bg-diletto-green/10 text-diletto-green border-diletto-green/20">
                        在籍
                      </Badge>
                    ) : (
                      <Badge className="bg-diletto-red/[0.06] text-diletto-red border-diletto-red/15">
                        退職
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {emp.status === 'active' && (
                      <Link
                        href={`/mgr/messages?to=${emp.id}`}
                        className="text-xs px-2 py-1 rounded-md border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all whitespace-nowrap inline-block"
                        title={`${emp.last_name} ${emp.first_name} さんに個別連絡`}
                      >
                        💬 個別連絡
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
