/* Supabase への接続構成の正本。scripts/*.mjs は必ずここを経由する。
   接続先の決定は constraints.md §2 を参照（pooler 経由 + 証明書検証あり）。

   pooler が提示するのは Supabase の私設 CA チェーン（Supabase Root 2021 CA）であって
   公的 CA ではない。そのため OS / Node の既定信頼ストアでは検証できず、
   信頼アンカーを scripts/certs/*.crt で明示する必要がある。
   ここを省いて ssl:{rejectUnauthorized:false} にすると service role 相当の資格情報が
   中間者に対して無防備になる（2026-07-17 に全スクリプトから撤去済）。 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/* pooler のみ。直接ホスト db.<ref>.supabase.co は IPv6-only で Windows から届かない（§2） */
const POOLER_HOST = 'aws-1-ap-southeast-1.pooler.supabase.com';
const POOLER_PORT = 6543; // transaction mode
const CERT_DIR = path.resolve(__dirname, 'certs');

/** .env.local を読む（KEY=VALUE / # コメント行は無視） */
export function loadEnv(file = '.env.local') {
  const abs = path.resolve(__dirname, '..', file);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`${file} が読めません（${abs}）。DATABASE_URL の定義が必要です。`);
  }
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((l) => !l.startsWith('#'))
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

/* 信頼アンカーはディレクトリ内の .crt 全部。Supabase は同一 CN のまま鍵違いの
   root を再発行する（prod-ca-2021 と prod-ca-2025 は CN 同一・鍵別物）。
   両方を信頼しておけば、pooler がどちらに切り替わっても接続が落ちない。
   将来 root が増えたら certs/ に置くだけでよい。 */
function loadTrustAnchors() {
  const files = fs
    .readdirSync(CERT_DIR)
    .filter((f) => f.endsWith('.crt'))
    .sort();
  if (files.length === 0) {
    throw new Error(`信頼アンカーが無い（${CERT_DIR}）。constraints.md §2 の手順で CA を取得すること。`);
  }
  return files.map((f) => fs.readFileSync(path.join(CERT_DIR, f), 'utf8'));
}

/** DB URL（直接ホスト形式）から pooler 用の接続情報を取り出す。
    URL 自体は db.<ref>.supabase.co 形式のままでよい（接続先は pooler に読み替える）。 */
function parseDatabaseUrl(env) {
  const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('DATABASE_URL / SUPABASE_DB_URL のどちらも見つかりません。');
  const m = dbUrl.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
  if (!m) throw new Error('DB URL parse fail（postgres://user:pass@db.<ref>.supabase.co 形式を想定）');
  return { password: decodeURIComponent(m[2]), ref: m[3] };
}

/**
 * 検証有効な pg.Client を返す（connect は呼び出し側で行う）。
 * rejectUnauthorized:true + servername=host で psql の sslmode=verify-full 相当。
 */
export function createPgClient(env = loadEnv()) {
  const { password, ref } = parseDatabaseUrl(env);
  return new pg.Client({
    host: POOLER_HOST,
    port: POOLER_PORT,
    user: `postgres.${ref}`,
    password,
    database: 'postgres',
    /* servername はここで渡しても無意味。pg は ssl を Object.assign した後に
       servername = host で上書きする（pg/lib/connection.js）。結果として名前検証は
       常に接続先ホスト自身に対して行われ、呼び出し側から弱められない。 */
    ssl: {
      ca: loadTrustAnchors(),
      rejectUnauthorized: true,
    },
  });
}
