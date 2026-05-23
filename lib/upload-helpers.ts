// ファイル名サニタイズ
//
// 旧コメントは「Supabase Storage は Unicode パスを許可する」と書いていたが
// これは誤りで、Supabase Storage は object name に非 ASCII (日本語・絵文字等)
// を含むと StorageError: "Invalid key" で拒否する。本番でファイル名に日本語を
// 含む画像/PDF が全てアップロード失敗していた (2026-05-23 報告) ため、
// ASCII 英数字 + ドット + ハイフン + アンダースコアのみ残す仕様に修正。
//
// パス全体は buildStoragePath 側で `${timestamp}_${random}_` を前置しており
// 一意性は保証されるため、元ファイル名が完全に日本語で空になる場合は
// 'file' をフォールバックにする。元のオリジナルファイル名は呼び出し側で
// DB の label / caption / pdf_storage_path とは別カラムに保持できる。

const ASCII_SAFE = /[a-zA-Z0-9._-]/;

function sanitizeAsciiOnly(s: string): string {
  // Array.from でサロゲートペアを安全に扱う (絵文字含むため)
  return Array.from(s).map((ch) => (ASCII_SAFE.test(ch) ? ch : '_')).join('');
}

export function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, '_');
  /* `.png` のような拡張子だけのファイルでも base を 'file' フォールバックに
     拾えるよう dotIdx >= 0 で分離する */
  const dotIdx = trimmed.lastIndexOf('.');
  const baseRaw = dotIdx >= 0 ? trimmed.slice(0, dotIdx) : trimmed;
  const extRaw = dotIdx >= 0 ? trimmed.slice(dotIdx + 1) : '';
  const base = sanitizeAsciiOnly(baseRaw)
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'file';
  // 拡張子部分は ASCII セーフ文字のうち '.', '_' を除去 (拡張子に通常含まれない)
  const ext = sanitizeAsciiOnly(extRaw).replace(/[._]/g, '');
  return ext ? `${base}.${ext}` : base;
}

// 複数アップロード向けに一意パスを作る。timestamp + random で衝突回避するので
// ファイル名は識別目的より「Storage が受理する形」優先で sanitize する。
export function buildStoragePath(prefix: string, tenantId: string, filename: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${tenantId}/${timestamp}_${random}_${sanitizeFilename(filename)}`;
}
