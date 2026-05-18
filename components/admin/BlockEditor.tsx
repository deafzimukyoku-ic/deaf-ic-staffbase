'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { buildStoragePath } from '@/lib/upload-helpers';

// ---- Block 型 ----
export type ContentBlock =
  | { type: 'text'; value: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'video'; url: string; source: 'youtube' | 'google_drive' }
  | { type: 'pdf'; url: string; label?: string };

function detectVideoSource(url: string): 'youtube' | 'google_drive' {
  if (/(youtube\.com|youtu\.be)/.test(url)) return 'youtube';
  return 'google_drive';
}

interface Props {
  tenantId: string | null;
  blocks: ContentBlock[];
  onChange: (next: ContentBlock[]) => void;
  storagePrefix?: string; // 'compliance' | 'trainings' | 'announcements' | 'manuals'
}

export function BlockEditor({ tenantId, blocks, onChange, storagePrefix = 'content' }: Props) {
  const supabase = createClient();
  const [uploading, setUploading] = useState<number | null>(null);

  function updateBlock(index: number, next: Partial<ContentBlock>) {
    const copy = [...blocks];
    copy[index] = { ...copy[index], ...(next as any) };
    onChange(copy);
  }

  function removeBlock(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
  }

  function moveBlock(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const copy = [...blocks];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  }

  function addBlock(type: ContentBlock['type']) {
    const next: ContentBlock =
      type === 'text' ? { type: 'text', value: '' }
      : type === 'image' ? { type: 'image', url: '', caption: '' }
      : type === 'video' ? { type: 'video', url: '', source: 'youtube' }
      : { type: 'pdf', url: '', label: '' };
    onChange([...blocks, next]);
  }

  async function handleImageUpload(index: number, file: File) {
    if (!tenantId) {
      toast.error('テナント情報が取得できていません');
      return;
    }
    setUploading(index);
    try {
      const path = buildStoragePath(storagePrefix, tenantId, file.name);
      const { error } = await supabase.storage.from('documents').upload(path, file, {
        contentType: file.type || 'image/jpeg',
      });
      if (error) {
        toast.error('画像アップロードに失敗しました');
        return;
      }
      // 署名付きURL取得（長期のため10年設定）
      const { data: signed } = await supabase.storage.from('documents').createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      if (!signed?.signedUrl) {
        toast.error('画像URLの取得に失敗しました');
        return;
      }
      updateBlock(index, { url: signed.signedUrl } as any);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 && (
        <div className="p-4 border border-dashed border-brand-gray/20 rounded-md text-center text-xs text-brand-gray-light">
          ブロックを追加してコンテンツを作成してください
        </div>
      )}

      {blocks.map((block, i) => (
        <div key={i} className="border border-brand-gray/15 rounded-md bg-white p-3 space-y-2 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-brand-gray-light uppercase tracking-wider">
              {block.type === 'text' ? '📝 文章'
                : block.type === 'image' ? '🖼️ 画像'
                : block.type === 'video' ? '🎬 動画'
                : '📁 PDF'}
            </span>
            <div className="flex gap-1">
              <button type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0}
                className="h-7 w-7 inline-flex items-center justify-center rounded border border-brand-gray/15 text-brand-gray hover:bg-brand-beige disabled:opacity-30">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
              <button type="button" onClick={() => moveBlock(i, 1)} disabled={i === blocks.length - 1}
                className="h-7 w-7 inline-flex items-center justify-center rounded border border-brand-gray/15 text-brand-gray hover:bg-brand-beige disabled:opacity-30">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              <button type="button" onClick={() => removeBlock(i)}
                className="h-7 w-7 inline-flex items-center justify-center rounded border border-brand-red/30 text-brand-red hover:bg-brand-red/5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
              </button>
            </div>
          </div>

          {block.type === 'text' && (
            <Textarea
              rows={4}
              value={block.value}
              onChange={(e) => updateBlock(i, { value: e.target.value } as any)}
              placeholder="文章を入力..."
              className="rounded-md text-sm"
            />
          )}

          {block.type === 'image' && (
            <div className="space-y-2">
              {block.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={block.url} alt={block.caption || ''} className="max-h-48 rounded-md border border-brand-gray/10" />
              ) : null}
              <Input
                type="file"
                accept="image/*"
                disabled={uploading === i}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(i, f);
                }}
                className="rounded-md text-xs"
              />
              {uploading === i && <p className="text-xs text-brand-gray">アップロード中...</p>}
              <Input
                value={block.caption || ''}
                onChange={(e) => updateBlock(i, { caption: e.target.value } as any)}
                placeholder="キャプション（任意）"
                className="rounded-md text-xs"
              />
            </div>
          )}

          {block.type === 'video' && (
            <div className="space-y-2">
              <Input
                value={block.url}
                onChange={(e) => updateBlock(i, { url: e.target.value, source: detectVideoSource(e.target.value) } as any)}
                placeholder="YouTube または Google Drive の動画URLを貼り付け"
                className="rounded-md text-xs"
              />
              <p className="text-[10px] text-brand-gray-light">
                自動判定: {block.source === 'youtube' ? '▶ YouTube' : '📁 Google Drive'}
              </p>
            </div>
          )}

          {block.type === 'pdf' && (
            <div className="space-y-2">
              <Input
                value={block.url}
                onChange={(e) => updateBlock(i, { url: e.target.value } as any)}
                placeholder="Google Drive の共有URLを貼り付け"
                className="rounded-md text-xs"
              />
              <Input
                value={block.label || ''}
                onChange={(e) => updateBlock(i, { label: e.target.value } as any)}
                placeholder="ラベル（任意、例: 就業規則.pdf）"
                className="rounded-md text-xs"
              />
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock('text')} className="rounded-md text-xs">📝 文章を追加</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock('image')} className="rounded-md text-xs">🖼️ 画像を追加</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock('video')} className="rounded-md text-xs">🎬 動画URLを追加</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock('pdf')} className="rounded-md text-xs">📁 PDF URLを追加</Button>
      </div>
    </div>
  );
}
