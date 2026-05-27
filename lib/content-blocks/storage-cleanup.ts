'use client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentBlockJson } from '@/lib/types';

/* content_blocks を持つ行 (manuals / trainings / announcements / compliance_documents)
   の Storage 同期削除ヘルパ。

   - 削除: deleteRowWithMediaCleanup() … 行削除前に Storage からも消す
   - 差分削除: cleanupRemovedBlocks() … 編集保存時に「消えたブロック」だけ Storage から消す

   Storage 削除失敗時もエラー throw せず警告だけにして DB 操作は続行する
   (cleanup-orphan-storage.mjs で後追い回収可能なため。
    致命は逆向き = DB は消えたのに Storage に永遠に残るのが許せる代わり、
    DB が更新できないとユーザー操作が完了しないので DB 優先で続行)。

   バケット振り分け: path が `videos/` で始まれば videos バケット、それ以外は documents バケット
   (buildStoragePath が prefix を先頭に付ける規約と整合)。

   migration 210/213 の storage RLS で admin/manager + status='active' の場合のみ remove 可。
   manager は同 tenant のファイルしか触れない (RLS で強制)。 */

export type BlockTable = 'manuals' | 'trainings' | 'announcements' | 'compliance_documents';

export function extractStoragePathsFromBlocks(
  blocks: ContentBlockJson[] | null | undefined,
): string[] {
  if (!blocks) return [];
  const paths: string[] = [];
  for (const b of blocks) {
    if (!b) continue;
    const sp = (b as { storage_path?: unknown }).storage_path;
    if (typeof sp === 'string' && sp.length > 0) paths.push(sp);
  }
  return paths;
}

interface BucketedPaths {
  videos: string[];
  documents: string[];
}

function bucketizePaths(paths: string[]): BucketedPaths {
  const videos: string[] = [];
  const documents: string[] = [];
  for (const p of paths) {
    if (p.startsWith('videos/')) videos.push(p);
    else documents.push(p);
  }
  return { videos, documents };
}

/* バケット別に remove を呼び出し、削除数 / 失敗数を集計する */
async function removeBucketed(
  supabase: SupabaseClient,
  paths: string[],
  context: string,
): Promise<{ removed: number; failed: number }> {
  if (paths.length === 0) return { removed: 0, failed: 0 };
  const { videos, documents } = bucketizePaths(paths);
  let removed = 0;
  let failed = 0;

  if (videos.length > 0) {
    const { data, error } = await supabase.storage.from('videos').remove(videos);
    if (error) {
      console.warn(`[${context}] videos remove failed`, { paths: videos, error });
      failed += videos.length;
    } else {
      removed += data?.length ?? videos.length;
    }
  }
  if (documents.length > 0) {
    const { data, error } = await supabase.storage.from('documents').remove(documents);
    if (error) {
      console.warn(`[${context}] documents remove failed`, { paths: documents, error });
      failed += documents.length;
    } else {
      removed += data?.length ?? documents.length;
    }
  }
  return { removed, failed };
}

export interface DeleteResult {
  deleted: boolean;
  storageRemoved: number;
  storageFailed: number;
  error?: string;
}

export async function deleteRowWithMediaCleanup(
  supabase: SupabaseClient,
  table: BlockTable,
  id: string,
): Promise<DeleteResult> {
  const { data: row, error: selErr } = await supabase
    .from(table)
    .select('content_blocks')
    .eq('id', id)
    .single();
  if (selErr) {
    return { deleted: false, storageRemoved: 0, storageFailed: 0, error: selErr.message };
  }

  const paths = extractStoragePathsFromBlocks(
    row?.content_blocks as ContentBlockJson[] | null,
  );
  const { removed, failed } = await removeBucketed(supabase, paths, `deleteRowWithMediaCleanup:${table}/${id}`);

  const { error: delErr } = await supabase.from(table).delete().eq('id', id);
  if (delErr) {
    return { deleted: false, storageRemoved: removed, storageFailed: failed, error: delErr.message };
  }
  return { deleted: true, storageRemoved: removed, storageFailed: failed };
}

/* 編集保存時の差分削除: old から new に置き換わったとき消えた storage_path を Storage から削除する。
   DB UPDATE 成功後に呼ぶ前提 (UPDATE 失敗時にこれを呼ぶと Storage だけ消えて DB が古いまま=食い違い)。 */
export async function cleanupRemovedBlocks(
  supabase: SupabaseClient,
  oldBlocks: ContentBlockJson[] | null | undefined,
  newBlocks: ContentBlockJson[] | null | undefined,
  context: string,
): Promise<{ removed: number; failed: number }> {
  const oldPaths = new Set(extractStoragePathsFromBlocks(oldBlocks));
  const newPaths = new Set(extractStoragePathsFromBlocks(newBlocks));
  const removedPaths: string[] = [];
  for (const p of oldPaths) {
    if (!newPaths.has(p)) removedPaths.push(p);
  }
  return removeBucketed(supabase, removedPaths, `cleanupRemovedBlocks:${context}`);
}
