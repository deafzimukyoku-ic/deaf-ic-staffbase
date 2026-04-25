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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { TRAINING_RESULT } from '@/lib/constants';
import { toast } from 'sonner';

interface Submission {
  id: string;
  employee_id: string;
  summary_text: string;
  result: string;
  admin_comment: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  employees: { last_name: string; first_name: string };
}

export default function TrainingSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trainingTitle, setTrainingTitle] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<Submission | null>(null);
  const [reviewResult, setReviewResult] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: training } = await supabase.from('trainings').select('title').eq('id', id).single();
      if (training) setTrainingTitle(training.title);

      const { data } = await supabase
        .from('training_submissions')
        .select('*, employees(last_name, first_name)')
        .eq('training_id', id)
        .order('submitted_at', { ascending: false });

      setSubmissions((data as Submission[]) || []);
      setLoading(false);
    }
    load();
  }, [id]);

  function openReview(sub: Submission) {
    setReviewTarget(sub);
    setReviewResult(sub.result);
    setReviewComment(sub.admin_comment || '');
  }

  async function handleReview() {
    if (!reviewTarget) return;
    setSaving(true);

    const { error } = await supabase
      .from('training_submissions')
      .update({
        result: reviewResult,
        admin_comment: reviewComment || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', reviewTarget.id);

    if (error) { toast.error('保存に失敗しました'); setSaving(false); return; }

    setSubmissions((prev) =>
      prev.map((s) => s.id === reviewTarget.id ? { ...s, result: reviewResult, admin_comment: reviewComment, reviewed_at: new Date().toISOString() } : s)
    );

    // メール通知を送信（pending 以外）
    if (reviewResult !== 'pending') {
      try {
        const { data: empData } = await supabase
          .from('employees')
          .select('email')
          .eq('id', reviewTarget.employee_id)
          .single();

        if (empData?.email) {
          await fetch('/api/email/training-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeEmail: empData.email,
              employeeName: `${reviewTarget.employees.last_name} ${reviewTarget.employees.first_name}`,
              trainingTitle,
              result: reviewResult,
              comment: reviewComment || undefined,
            }),
          });
        }
      } catch {
        // メール失敗は続行
      }
    }

    toast.success('判定を保存しました');
    setReviewTarget(null);
    setSaving(false);
  }

  const resultLabel: Record<string, string> = { pending: '未判定', passed: '合格', failed: '不合格', resubmit: '再提出' };
  const resultColor: Record<string, string> = {
    pending: 'bg-diletto-gold/[0.08] text-diletto-gold',
    passed: 'bg-diletto-green/10 text-diletto-green',
    failed: 'bg-diletto-red/[0.06] text-diletto-red',
    resubmit: 'bg-diletto-blue/[0.07] text-diletto-blue',
  };

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">提出一覧</h1>
          <p className="text-sm text-diletto-gray mt-1">{trainingTitle}</p>
        </div>
        <Button variant="outline" onClick={() => router.push('/admin/trainings')}>戻る</Button>
      </div>

      <div className="space-y-3">
        {submissions.map((sub) => (
          <Card key={sub.id}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{sub.employees.last_name} {sub.employees.first_name}</span>
                <Badge className={resultColor[sub.result]}>{resultLabel[sub.result]}</Badge>
              </div>
              <p className="text-sm text-diletto-gray whitespace-pre-wrap border rounded p-3 bg-diletto-beige mb-2">
                {sub.summary_text}
              </p>
              {sub.admin_comment && (
                <p className="text-xs text-diletto-gray border-l-2 border-diletto-blue pl-2 mb-2">{sub.admin_comment}</p>
              )}
              <Button variant="outline" size="sm" onClick={() => openReview(sub)}>判定する</Button>
            </CardContent>
          </Card>
        ))}
        {submissions.length === 0 && (
          <Card><CardContent className="py-12 text-center text-diletto-gray-light">まだ提出がありません</CardContent></Card>
        )}
      </div>

      <Dialog open={!!reviewTarget} onOpenChange={() => setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>合否判定</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>判定</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={reviewResult}
                onChange={(e) => setReviewResult(e.target.value)}
              >
                {TRAINING_RESULT.map((r) => <option key={r} value={r}>{resultLabel[r]}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>コメント（任意）</Label>
              <Textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>キャンセル</Button>
            <Button onClick={handleReview} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
