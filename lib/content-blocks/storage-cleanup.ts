'use client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentBlockJson } from '@/lib/types';

/* content_blocks を持つ行 (manuals / trainings / announcements / compliance_documents)
   を削除する前に、JSON 内の storage_path を documents バケットから削除する。

   Storage 削除失敗時もエラー throw せず警告だけにして DB DELETE は続行する
   (cleanup-orphan-storage.mjs で後追い回収可能なため)。

   migration 210 の storage RLS で admin/manager + status='active' の場合のみ remove 可。
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
  let storageRemoved = 0;
  let storageFailed = 0;
  if (paths.length > 0) {
    const { data, error } = await supabase.storage.from('documents').remove(paths);
    if (error) {
      console.warn(
        `[deleteRowWithMediaCleanup] storage remove failed for ${table}/${id}`,
        { paths, error },
      );
      storageFailed = paths.length;
    } else {
      storageRemoved = data?.length ?? paths.length;
    }
  }

  const { error: delErr } = await supabase.from(table).delete().eq('id', id);
  if (delErr) {
    return { deleted: false, storageRemoved, storageFailed, error: delErr.message };
  }
  return { deleted: true, storageRemoved, storageFailed };
}
