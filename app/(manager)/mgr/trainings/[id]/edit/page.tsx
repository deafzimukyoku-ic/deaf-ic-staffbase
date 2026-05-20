'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function EditTrainingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({ title: '', pdf_storage_path: '', youtube_url: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /* ON にすると recert_at を進めて全受講者に再受講を要求する
     (content-version-tracking)。既定 OFF。 */
  const [requireRecert, setRequireRecert] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('trainings')
        .select('title, pdf_storage_path, youtube_url')
        .eq('id', id)
        .single();

      if (data) {
        setForm({
          title: data.title || '',
          pdf_storage_path: data.pdf_storage_path || '',
          youtube_url: data.youtube_url || '',
        });
      }
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);

    /* requireRecert=ON のときだけ recert_at を進め、過去の合格を旧版化して
       再受講を促す (content-version-tracking)。OFF なら据え置く。 */
    const updatePayload: Record<string, unknown> = {
      title: form.title.trim(),
      pdf_storage_path: form.pdf_storage_path.trim() || null,
      youtube_url: form.youtube_url.trim() || null,
    };
    if (requireRecert) updatePayload.recert_at = new Date().toISOString();
    const { error } = await supabase
      .from('trainings')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      toast.error('保存に失敗しました', { description: error.message });
      setSaving(false);
      return;
    }

    toast.success('研修を更新しました');
    router.push('/mgr/trainings');
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">研修を編集</h1>
        <Button variant="outline" onClick={() => router.push('/mgr/trainings')}>戻る</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">研修内容</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>タイトル *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="安全運転研修"
            />
          </div>
          <div className="space-y-2">
            <Label>YouTube URL</Label>
            <Input
              value={form.youtube_url}
              onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
          <div className="space-y-2">
            <Label>PDFパス（Storage）</Label>
            <Input
              value={form.pdf_storage_path}
              onChange={(e) => setForm({ ...form, pdf_storage_path: e.target.value })}
              placeholder="trainings/safety.pdf"
            />
          </div>

          {/* 再受講要求チェック。研修の内容を大きく変えたときに ON にする。
             content-version-tracking — ON で recert_at を進め過去の合格を旧版化。 */}
          <label className="flex items-start gap-2 rounded-md border border-brand-gray/15 bg-brand-beige/30 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={requireRecert}
              onChange={(e) => setRequireRecert(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="text-sm">
              <span className="font-bold">この変更で再受講を求める</span>
              <span className="block text-xs text-brand-gray-light mt-0.5">
                ON にすると、これまで合格した社員も「再受講が必要」扱いになり、閲覧レポート・
                ダッシュボードで未達成に戻ります。誤字修正など軽微な編集では OFF のままにしてください。
              </span>
            </span>
          </label>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
