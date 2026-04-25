// カテゴリの色プリセット・推奨絵文字
// color: トーン統一のためHEX自由入力ではなくプリセット10色から選択
// icon: 絵文字1文字をテナント任意入力。下記はUIでのショートカット候補

export const CATEGORY_COLOR_PRESETS: { hex: string; label: string }[] = [
  { hex: '#EF4444', label: '赤' },
  { hex: '#F97316', label: 'オレンジ' },
  { hex: '#F59E0B', label: '黄' },
  { hex: '#10B981', label: '緑' },
  { hex: '#14B8A6', label: 'ティール' },
  { hex: '#3B82F6', label: '青' },
  { hex: '#6366F1', label: 'インディゴ' },
  { hex: '#8B5CF6', label: '紫' },
  { hex: '#EC4899', label: 'ピンク' },
  { hex: '#6B7280', label: 'グレー' },
];

export const DEFAULT_CATEGORY_COLOR = '#6B7280';
export const DEFAULT_CATEGORY_ICON = '📁';

export const CATEGORY_ICON_SUGGESTIONS = [
  '📁', '📌', '📝', '📢', '📚', '🎓', '🏢', '🚗', '⚠️', '✅',
  '🔒', '💰', '🎯', '🛡️', '🧰', '🩺', '🍱', '🏆', '🔧', '💡',
];
