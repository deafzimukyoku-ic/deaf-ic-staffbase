/**
 * 開発モード(localhost)のみ、API レスポンスの個人名・メールフィールドを ●●×× にマスク。
 * 録画用 — 本番環境(NODE_ENV=production)では完全に bypass される。
 *
 * 対象フィールド (オブジェクトに last_name + first_name の両方がある時のみ):
 *   - last_name        → ●●
 *   - first_name       → ××
 *   - last_name_kana   → マル
 *   - first_name_kana  → バツ
 *   - email            → ●●@example.com  (employee 系オブジェクトのみ)
 *
 * 児童 (children テーブル, name + grade_type を持つオブジェクト):
 *   - name             → ●●××
 *
 * 子オブジェクト・配列は再帰的に処理。
 * facilities.name や tenants.email 等の単独フィールドは触らない (employee/child shape の時だけマスク)。
 */

export const IS_DEV_MASK_ENABLED = process.env.NODE_ENV === 'development';

function maskObj(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(maskObj);
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    const isEmpLike = 'last_name' in o && 'first_name' in o;
    const isChildLike = 'name' in o && 'grade_type' in o;
    const out: Record<string, unknown> = {};
    for (const k in o) {
      if (isEmpLike && k === 'last_name' && typeof o[k] === 'string') out[k] = '●●';
      else if (isEmpLike && k === 'first_name' && typeof o[k] === 'string') out[k] = '××';
      else if (isEmpLike && k === 'last_name_kana' && typeof o[k] === 'string') out[k] = 'マル';
      else if (isEmpLike && k === 'first_name_kana' && typeof o[k] === 'string') out[k] = 'バツ';
      else if (isEmpLike && k === 'email' && typeof o[k] === 'string') out[k] = '●●@example.com';
      else if (isChildLike && k === 'name' && typeof o[k] === 'string') out[k] = '●●××';
      else out[k] = maskObj(o[k]);
    }
    return out;
  }
  return obj;
}

/** Supabase の fetch をラップして、JSON レスポンスから個人名を消す。
 *  Supabase REST (PostgREST) と GraphQL 両方の応答に効く。 */
export function withDevNameMask(originalFetch: typeof fetch = fetch): typeof fetch {
  if (!IS_DEV_MASK_ENABLED) return originalFetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return res;
    /* 元 Response を破壊せず clone してから読む。失敗時はそのまま返す。 */
    try {
      const text = await res.clone().text();
      if (!text) return res;
      const data = JSON.parse(text);
      const masked = maskObj(data);
      return new Response(JSON.stringify(masked), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch {
      return res;
    }
  }) as typeof fetch;
}
