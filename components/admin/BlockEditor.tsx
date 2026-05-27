'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { buildStoragePath } from '@/lib/upload-helpers';
import { SignedMediaImage } from '@/components/media/SignedMedia';
import type { ContentBlockJson } from '@/lib/types';

// 旧来の import 名 (8 ファイルで `import { type ContentBlock }` されているので維持)
export type ContentBlock = ContentBlockJson;

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
    copy[index] = { ...copy[index], ...(next as object) } as ContentBlock;
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
      : type === 'image' ? { type: 'image', caption: '' }
      : type === 'video' ? { type: 'video', source: 'youtube', url: '' }
      : { type: 'pdf', label: '' };
    onChange([...blocks, next]);
  }

  async function uploadToStorage(
    file: File,
    contentType: string,
    label: string,
  ): Promise<string | null> {
    if (!tenantId) {
      toast.error('テナント情報が取得できていません');
      return null;
    }
    const path = buildStoragePath(storagePrefix, tenantId, file.name);
    const { error } = await supabase.storage.from('documents').upload(path, file, {
      contentType,
    });
    if (error) {
      /* error を握りつぶさない: Supabase の StorageError は message に詳細が入る。
         「Bucket not found」「new row violates row-level security policy」
         「Payload too large」(200MB 超) 等をユーザーに表示する。 */
      console.error(`[BlockEditor] ${label} upload failed`, { path, error });
      toast.error(`${label}アップロードに失敗しました`, { description: error.message });
      return null;
    }
    return path;
  }

  async function handleImageUpload(index: number, file: File) {
    setUploading(index);
    try {
      const path = await uploadToStorage(file, file.type || 'image/jpeg', '画像');
      if (!path) return;
      // 旧仕様 (10 年 Signed URL 直保存) は退職対策の穴になるため廃止。
      // storage_path のみ保存して BlockRenderer 側で都度発行する。
      updateBlock(index, { storage_path: path, url: undefined } as Partial<ContentBlock>);
    } finally {
      setUploading(null);
    }
  }

  async function handleVideoUpload(index: number, file: File) {
    setUploading(index);
    try {
      const path = await uploadToStorage(file, file.type || 'video/mp4', '動画');
      if (!path) return;
      updateBlock(index, {
        source: 'storage',
        storage_path: path,
        url: undefined,
      } as Partial<ContentBlock>);
    } finally {
      setUploading(null);
    }
  }

  async function handlePdfUpload(index: number, file: File) {
    setUploading(index);
    try {
      const path = await uploadToStorage(file, file.type || 'application/pdf', 'PDF');
      if (!path) return;
      updateBlock(index, {
        source: 'storage',
        storage_path: path,
        url: undefined,
      } as Partial<ContentBlock>);
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
              onChange={(e) => updateBlock(i, { value: e.target.value } as Partial<ContentBlock>)}
              placeholder="文章を入力..."
              className="rounded-md text-sm"
            />
          )}

          {block.type === 'image' && (
            <div className="space-y-2">
              {block.storage_path ? (
                <SignedMediaImage storagePath={block.storage_path} caption={block.caption} />
              ) : block.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
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
                onChange={(e) => updateBlock(i, { caption: e.target.value } as Partial<ContentBlock>)}
                placeholder="キャプション（任意）"
                className="rounded-md text-xs"
              />
            </div>
          )}

          {block.type === 'video' && (
            <div className="space-y-2">
              {block.source === 'storage' && block.storage_path ? (
                <div className="p-2 rounded bg-brand-blue/5 border border-brand-blue/10 text-xs space-y-1">
                  <p className="text-brand-blue font-medium">📹 Storage 動画</p>
                  <p className="font-mono text-brand-gray text-[10px] break-all">{block.storage_path}</p>
                  <button
                    type="button"
                    onClick={() => updateBlock(i, { source: 'youtube', storage_path: undefined, url: '' } as Partial<ContentBlock>)}
                    className="text-brand-red text-[10px] underline"
                  >
                    削除して別動画に変更
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    disabled={uploading === i}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleVideoUpload(i, f);
                    }}
                    className="rounded-md text-xs"
                  />
                  {uploading === i && <p className="text-xs text-brand-gray">アップロード中...</p>}
                  <p className="text-[10px] text-brand-gray-light">または YouTube URL を貼り付け↓</p>
                  <Input
                    value={block.url || ''}
                    onChange={(e) => updateBlock(i, { url: e.target.value, source: detectVideoSource(e.target.value), storage_path: undefined } as Partial<ContentBlock>)}
                    placeholder="YouTube URL（Google Drive は移行中）"
                    className="rounded-md text-xs"
                  />
                  {block.url && (
                    <p className="text-[10px] text-brand-gray-light">
                      自動判定: {block.source === 'youtube' ? '▶ YouTube' : '📁 Google Drive（移行猶予中・新規は動画ファイル直アップロード推奨）'}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {block.type === 'pdf' && (
            <div className="space-y-2">
              {block.source === 'storage' && block.storage_path ? (
                <div className="p-2 rounded bg-brand-blue/5 border border-brand-blue/10 text-xs space-y-1">
                  <p className="text-brand-blue font-medium">📁 Storage PDF</p>
                  <p className="font-mono text-brand-gray text-[10px] break-all">{block.storage_path}</p>
                  <button
                    type="button"
                    onClick={() => updateBlock(i, { source: undefined, storage_path: undefined, url: '' } as Partial<ContentBlock>)}
                    className="text-brand-red text-[10px] underline"
                  >
                    削除して別 PDF に変更
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    type="file"
                    accept="application/pdf"
                    disabled={uploading === i}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePdfUpload(i, f);
                    }}
                    className="rounded-md text-xs"
                  />
                  {uploading === i && <p className="text-xs text-brand-gray">アップロード中...</p>}
                  {block.url && (
                    <p className="text-[10px] text-brand-gray-light break-all">
                      旧 Drive URL: {block.url}（移行猶予中）
                    </p>
                  )}
                </>
              )}
              <Input
                value={block.label || ''}
                onChange={(e) => updateBlock(i, { label: e.target.value } as Partial<ContentBlock>)}
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
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock('video')} className="rounded-md text-xs">🎬 動画を追加</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock('pdf')} className="rounded-md text-xs">📁 PDFを追加</Button>
      </div>
    </div>
  );
}
