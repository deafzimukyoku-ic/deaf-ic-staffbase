/**
 * カテゴリ選択時に、そのカテゴリの audience をアイテム側 (announcement / compliance /
 * training / manual) の target_type / target_facility_ids にコピーするためのヘルパー。
 *
 * 仕様: docs/features/category-audience.md
 *
 * 想定挙動 (admin):
 *   - category が null / target_type='all' → アイテムも 'all' (全社員)
 *   - category.target_type='facility'      → アイテムも 'facility' + 同じ facility 配列
 *   ユーザーは保存前に手動で変更可能（強制ではなくデフォルト値の提案）。
 *
 * mgr 側は呼び出さない (mgr は target_type='facility' + managedFacilities 固定の運用)。
 */

import type { Category } from '@/lib/types';

export interface ItemAudience {
  target_type: 'all' | 'facility';
  target_facility_ids: string[];
}

export function categoryAudienceToItem(category: Category | null | undefined): ItemAudience {
  if (!category || category.target_type === 'all') {
    return { target_type: 'all', target_facility_ids: [] };
  }
  return {
    target_type: 'facility',
    target_facility_ids: [...(category.target_facility_ids ?? [])],
  };
}
