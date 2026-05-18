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

    const { error } = await supabase
      .from('trainings')
      .update({
        title: form.title.trim(),
        pdf_storage_path: form.pdf_storage_path.trim() || null,
        youtube_url: form.youtube_url.trim() || null,
      })
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
