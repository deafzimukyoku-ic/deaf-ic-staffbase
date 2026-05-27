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

// アップロード上限 (各バケットの file_size_limit と整合):
//   - 動画: videos バケット 500 MB (migration 213)
//   - 画像/PDF: documents バケット 200 MB (migration 212) のうち、UX 上は画像 10 / PDF 50 で制限
const IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];
const VIDEO_MAX_SIZE_BYTES = 500 * 1024 * 1024;
const VIDEO_ALLOWED_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const PDF_MAX_SIZE_BYTES = 50 * 1024 * 1024;
const PDF_ALLOWED_MIME_TYPES = ['application/pdf'];

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
    /* 新規動画ブロックは Storage アップロード強制 (YouTube/Drive URL 直貼りは廃止)。
       既存の YouTube/Drive 動画ブロックは BlockRenderer 側で互換維持。 */
    const next: ContentBlock =
      type === 'text' ? { type: 'text', value: '' }
      : type === 'image' ? { type: 'image', caption: '' }
      : type === 'video' ? { type: 'video', source: 'storage', storage_path: '' }
      : { type: 'pdf', source: 'storage', storage_path: '', label: '' };
    onChange([...blocks, next]);
  }

  /* 共通アップロード。bucket は呼出側が決める (動画 → videos / それ以外 → documents)。 */
  async function uploadToStorage(
    file: File,
    bucket: 'videos' | 'documents',
    pathPrefix: string,
    contentType: string,
    label: string,
  ): Promise<string | null> {
    if (!tenantId) {
      toast.error('テナント情報が取得できていません');
      return null;
    }
    const path = buildStoragePath(pathPrefix, tenantId, file.name);
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType });
    if (error) {
      /* StorageError は RLS / file_size_limit / mime_types ポリシーで弾かれた詳細を返す。
         ユーザーに表示すれば管理者が原因を即特定できる */
      console.error(`[BlockEditor] ${label} upload failed`, { bucket, path, error });
      toast.error(`${label}アップロードに失敗しました`, { description: error.message });
      return null;
    }
    return path;
  }

  async function handleImageUpload(index: number, file: File) {
    if (file.size > IMAGE_MAX_SIZE_BYTES) {
      toast.error('画像サイズが上限 10 MB を超えています', {
        description: `選択されたファイル: ${(file.size / 1024 / 1024).toFixed(1)} MB`,
      });
      return;
    }
    if (!IMAGE_ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error('対応していない画像形式です', {
        description: `JPEG / PNG / WebP / HEIC / GIF のみ対応 (選択: ${file.type || '不明'})`,
      });
      return;
    }
    setUploading(index);
    try {
      const path = await uploadToStorage(file, 'documents', storagePrefix, file.type || 'image/jpeg', '画像');
      if (!path) return;
      // storage_path のみ保存。Signed URL は SignedMediaImage が都度発行 (退職者は 403 で自動遮断)
      updateBlock(index, { storage_path: path, url: undefined } as Partial<ContentBlock>);
      toast.success('画像をアップロードしました');
    } finally {
      setUploading(null);
    }
  }

  async function handleVideoUpload(index: number, file: File) {
    if (file.size > VIDEO_MAX_SIZE_BYTES) {
      toast.error('動画サイズが上限 500 MB を超えています', {
        description: `選択されたファイル: ${(file.size / 1024 / 1024).toFixed(1)} MB`,
      });
      return;
    }
    if (!VIDEO_ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error('対応していない動画形式です', {
        description: `mp4 / webm / mov のみ対応 (選択: ${file.type || '不明'})`,
      });
      return;
    }
    setUploading(index);
    try {
      /* 動画は専用 videos バケット (500 MB / video MIME 限定 / migration 213) に保存 */
      const path = await uploadToStorage(file, 'videos', 'videos', file.type || 'video/mp4', '動画');
      if (!path) return;
      updateBlock(index, {
        source: 'storage',
        storage_path: path,
        url: undefined,
      } as Partial<ContentBlock>);
      toast.success('動画をアップロードしました');
    } finally {
      setUploading(null);
    }
  }

  async function handlePdfUpload(index: number, file: File) {
    if (file.size > PDF_MAX_SIZE_BYTES) {
      toast.error('PDF サイズが上限 50 MB を超えています', {
        description: `選択されたファイル: ${(file.size / 1024 / 1024).toFixed(1)} MB`,
      });
      return;
    }
    if (!PDF_ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error('PDF ファイルを選択してください', {
        description: `選択: ${file.type || '不明'}`,
      });
      return;
    }
    setUploading(index);
    try {
      const path = await uploadToStorage(file, 'documents', storagePrefix, 'application/pdf', 'PDF');
      if (!path) return;
      updateBlock(index, {
        source: 'storage',
        storage_path: path,
        url: undefined,
      } as Partial<ContentBlock>);
      toast.success('PDF をアップロードしました');
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
              <p className="text-[10px] text-brand-gray-light">
                JPEG / PNG / WebP / HEIC / GIF、最大 10 MB
              </p>
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
                /* Storage 動画 (新形式): プレビュー + 別動画への差し替えボタン */
                <div className="p-2 rounded bg-brand-blue/5 border border-brand-blue/10 text-xs space-y-1">
                  <p className="text-brand-blue font-medium">📹 Storage 動画</p>
                  <p className="font-mono text-brand-gray text-[10px] break-all">{block.storage_path}</p>
                  <button
                    type="button"
                    onClick={() => updateBlock(i, { source: 'storage', storage_path: '', url: undefined } as Partial<ContentBlock>)}
                    className="text-brand-red text-[10px] underline"
                  >
                    削除して別動画に変更
                  </button>
                </div>
              ) : block.source === 'youtube' || block.source === 'google_drive' ? (
                /* 既存 YouTube/Drive ブロック (互換維持): URL 編集のみ可能、新規追加は不可。
                   Storage に切り替えたい場合はブロック自体を削除して動画ブロックを再追加してもらう。 */
                <>
                  <Input
                    value={block.url || ''}
                    onChange={(e) => updateBlock(i, { url: e.target.value } as Partial<ContentBlock>)}
                    placeholder={block.source === 'youtube' ? 'YouTube URL' : 'Google Drive URL'}
                    className="rounded-md text-xs"
                  />
                  <p className="text-[10px] text-brand-gray-light">
                    ソース: {block.source === 'youtube' ? '▶ YouTube' : '📁 Google Drive (旧形式・新規追加不可)'}
                  </p>
                </>
              ) : (
                /* 新規動画ブロック (source='storage' + storage_path='' の状態) → ファイルアップロード */
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
                  <p className="text-[10px] text-brand-gray-light">
                    mp4 / webm / mov、最大 500 MB
                  </p>
                </>
              )}
            </div>
          )}

          {block.type === 'pdf' && (
            <div className="space-y-2">
              {block.source === 'storage' && block.storage_path ? (
                /* Storage PDF (新形式): プレビュー + 別 PDF への差し替えボタン */
                <div className="p-2 rounded bg-brand-blue/5 border border-brand-blue/10 text-xs space-y-1">
                  <p className="text-brand-blue font-medium">📁 Storage PDF</p>
                  <p className="font-mono text-brand-gray text-[10px] break-all">{block.storage_path}</p>
                  <button
                    type="button"
                    onClick={() => updateBlock(i, { source: 'storage', storage_path: '', url: undefined } as Partial<ContentBlock>)}
                    className="text-brand-red text-[10px] underline"
                  >
                    削除して別 PDF に変更
                  </button>
                </div>
              ) : block.url ? (
                /* 既存 Drive PDF (互換維持): URL は表示のみ。新規 Drive 投稿はできない */
                <>
                  <p className="text-[10px] text-brand-gray-light break-all">
                    旧 Drive URL: {block.url}（移行猶予中・新規追加不可）
                  </p>
                </>
              ) : (
                /* 新規 PDF ブロック → ファイルアップロード */
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
                  <p className="text-[10px] text-brand-gray-light">PDF、最大 50 MB</p>
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
