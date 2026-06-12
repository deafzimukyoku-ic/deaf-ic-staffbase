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

// 画像のみ Storage アップロード (documents バケット, migration 212)。
// 動画/PDF は URL 入力 (YouTube / Google Drive) に一本化したため上限定数は不要。
// 背景: Supabase プロジェクト全体の Storage アップロード上限が 50MB のままで
//   50MB 超の動画/PDF を Storage に上げられないため、URL 直貼りに戻した (2026-06-12)。
const IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];

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
    /* 動画/PDF は URL 直貼り (YouTube / Google Drive) に一本化。画像のみ Storage アップロード。
       既存の Storage 動画/PDF は編集画面でプレビュー + URL への差し替えが可能
       (BlockRenderer は URL/Storage 両形式を描画する)。 */
    const next: ContentBlock =
      type === 'text' ? { type: 'text', value: '' }
      : type === 'image' ? { type: 'image', caption: '' }
      : type === 'video' ? { type: 'video', source: 'youtube', url: '' }
      : { type: 'pdf', source: 'google_drive', url: '', label: '' };
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
                /* 既存の Storage 動画 (移行済み): プレビュー + URL への差し替え */
                <div className="p-2 rounded bg-brand-blue/5 border border-brand-blue/10 text-xs space-y-1">
                  <p className="text-brand-blue font-medium">📹 Storage 動画 (アップロード済み)</p>
                  <p className="font-mono text-brand-gray text-[10px] break-all">{block.storage_path}</p>
                  <button
                    type="button"
                    onClick={() => updateBlock(i, { source: 'youtube', storage_path: undefined, url: '' } as Partial<ContentBlock>)}
                    className="text-brand-red text-[10px] underline"
                  >
                    削除して URL に変更
                  </button>
                </div>
              ) : (
                /* URL 入力。source は貼られた URL から自動判定 (YouTube / Google Drive) */
                <>
                  <Input
                    value={block.url || ''}
                    onChange={(e) => {
                      const url = e.target.value;
                      const source: 'youtube' | 'google_drive' =
                        /(?:youtube\.com|youtu\.be)/i.test(url) ? 'youtube' : 'google_drive';
                      updateBlock(i, { source, url, storage_path: undefined } as Partial<ContentBlock>);
                    }}
                    placeholder="YouTube または Google Drive の動画 URL"
                    className="rounded-md text-xs"
                  />
                  <p className="text-[10px] text-brand-gray-light">
                    YouTube / Google Drive の共有 URL を貼り付け（YouTube は埋め込み再生、Drive は新規タブで再生）
                  </p>
                </>
              )}
            </div>
          )}

          {block.type === 'pdf' && (
            <div className="space-y-2">
              {block.source === 'storage' && block.storage_path ? (
                /* 既存の Storage PDF (移行済み): プレビュー + URL への差し替え */
                <div className="p-2 rounded bg-brand-blue/5 border border-brand-blue/10 text-xs space-y-1">
                  <p className="text-brand-blue font-medium">📁 Storage PDF (アップロード済み)</p>
                  <p className="font-mono text-brand-gray text-[10px] break-all">{block.storage_path}</p>
                  <button
                    type="button"
                    onClick={() => updateBlock(i, { source: 'google_drive', storage_path: undefined, url: '' } as Partial<ContentBlock>)}
                    className="text-brand-red text-[10px] underline"
                  >
                    削除して URL に変更
                  </button>
                </div>
              ) : (
                /* URL 入力 (Google Drive 等の共有 URL) */
                <>
                  <Input
                    value={block.url || ''}
                    onChange={(e) => updateBlock(i, { source: 'google_drive', url: e.target.value, storage_path: undefined } as Partial<ContentBlock>)}
                    placeholder="Google Drive などの PDF 共有 URL"
                    className="rounded-md text-xs"
                  />
                  <p className="text-[10px] text-brand-gray-light">
                    Google Drive の共有 URL を貼り付け（/preview 埋め込み表示）
                  </p>
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
