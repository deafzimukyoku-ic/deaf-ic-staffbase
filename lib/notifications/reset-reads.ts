/**
 * 「重要な変更として再通知する」時の既読リセットヘルパー（deaf-ic）。
 * 既読テーブルから該当アイテム行を DELETE。training は除外。
 */

import { createClient as createSbClient } from '@supabase/supabase-js';
import type { PublishContentType } from './event-codes';

function admin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function resetReadsForImportantUpdate(
  contentType: PublishContentType,
  itemId: string,
): Promise<{ deleted: number }> {
  const sb = admin();
  switch (contentType) {
    case 'announcement': {
      const { count } = await sb
        .from('announcement_reads')
        .delete({ count: 'exact' })
        .eq('announcement_id', itemId);
      return { deleted: count ?? 0 };
    }
    case 'compliance': {
      const { count } = await sb
        .from('compliance_acknowledgments')
        .delete({ count: 'exact' })
        .eq('compliance_document_id', itemId);
      return { deleted: count ?? 0 };
    }
    case 'manual': {
      const { count } = await sb
        .from('manual_reads')
        .delete({ count: 'exact' })
        .eq('manual_id', itemId);
      return { deleted: count ?? 0 };
    }
    case 'training':
      return { deleted: 0 };
  }
}
