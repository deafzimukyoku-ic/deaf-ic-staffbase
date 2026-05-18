'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MAX_AI_DIAGNOSIS_PER_MONTH } from '@/lib/constants';
import { toast } from 'sonner';
import type { Employee } from '@/lib/types';

export default function TeamDiagnosisPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;
      setTenantId(me.tenant_id);

      const { data } = await supabase
        .from('employees')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .eq('status', 'active')
        .order('employee_number');

      setEmployees((data as Employee[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleRun() {
    if (selected.size < 2) { toast.error('2名以上選択してください'); return; }
    setRunning(true);

    const res = await fetch('/api/ai/team-compat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_ids: Array.from(selected) }),
    });

    const data = await res.json();
    if (!res.ok) { toast.error(data.error); setRunning(false); return; }

    setResult(data.result);
    toast.success('チーム相性診断が完了しました');
    setRunning(false);
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">チーム相性診断</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">社員を選択（2名以上）</CardTitle>
          <CardDescription>{selected.size}名 選択中</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-3 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={selected.has(emp.id)}
                  onChange={() => toggleSelect(emp.id)}
                  className="rounded"
                />
                <span className="text-sm">{emp.last_name} {emp.first_name}</span>
              </label>
            ))}
          </div>
          <Button
            onClick={handleRun}
            disabled={running || selected.size < 2}
            className="mt-4 w-full"
          >
            {running ? '診断中...' : 'チーム相性を診断'}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline">チーム相性</Badge>
              <span className="text-xs text-brand-gray-light">{new Date().toLocaleString('ja-JP')}</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{result}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
