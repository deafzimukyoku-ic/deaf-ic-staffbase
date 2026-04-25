// ファイル名サニタイズ：日本語・英数字はそのまま、ファイルシステム危険文字だけ除去
// Supabase Storage は Unicode パスを許可するので日本語を維持して可読性を確保する

const UNSAFE_FS_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeFilename(name: string): string {
  // 先頭/末尾の空白・ドットを除去し、危険文字は _ に置換
  const cleaned = name.trim().replace(UNSAFE_FS_CHARS, '_').replace(/\s+/g, '_');
  // 複数連続 _ を1つに、先頭末尾 _ を除去
  return cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'file';
}

// 複数アップロード向けに一意パスを作る
export function buildStoragePath(prefix: string, tenantId: string, filename: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${tenantId}/${timestamp}_${random}_${sanitizeFilename(filename)}`;
}
