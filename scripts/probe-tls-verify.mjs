/* pooler に「証明書検証を有効にしたまま」接続できることの実証（constraints.md §2 の根拠）。
   検証が本当に効いていることを示すため、成功例だけでなく失敗するはずのケースも確かめる:
     1. 正: certs/*.crt を信頼 → 接続でき、socket.authorized が true
     2. 負: OS 既定ストアのみ → 私設 CA なので検証不能で失敗するはず
     3. 負: 別 root だけ信頼 → 失敗するはず
     4. 名前検証: 実際に提示された leaf 証明書に対し node の checkServerIdentity を直接適用

   4 について: ssl.servername を偽装して pg に渡すテストは意味を成さない。
   pg は ssl を Object.assign した後に servername = host で上書きするため、偽装値は捨てられる
   （= 呼び出し側から名前検証を弱められない）。よって名前検証は、実接続で取得した本物の
   leaf 証明書に対して node が使う関数そのものを当てて確かめる。 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import tls from 'node:tls';
import pg from 'pg';
import { createPgClient, loadEnv } from './_db.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const HOST = 'aws-1-ap-southeast-1.pooler.supabase.com';
const env = loadEnv();
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) throw new Error('DATABASE_URL parse fail');
const [password, ref] = [decodeURIComponent(m[2]), m[3]];

let failures = 0;
const ok = (label, detail) => console.log(`✅ ${label}\n     → ${detail}`);
const ng = (label, detail) => { console.log(`❌ ${label}\n     → ${detail}`); failures++; };

console.log(`--- pooler TLS 検証テスト (${HOST}:6543) ---\n`);

/* 1. 正: 正規の信頼アンカーで接続でき、かつ node 自身が authorized と判定していること */
let leafCert = null;
{
  const label = '[正] scripts/certs/*.crt を信頼 + rejectUnauthorized:true';
  const client = createPgClient(env);
  try {
    await client.connect();
    const r = await client.query('select current_user, version()');
    const sock = client.connection.stream;
    leafCert = sock.getPeerCertificate(true);
    if (sock.authorized !== true) {
      ng(label, `接続はしたが authorized=false (${sock.authorizationError})`);
    } else {
      ok(label, `接続成功 user=${r.rows[0].current_user} / ${r.rows[0].version.split(' on ')[0]}`);
      console.log(`     → authorized=true / leaf CN=${leafCert.subject.CN}`);
      console.log(`     → issuer=${leafCert.issuer.CN} / SAN=${leafCert.subjectaltname}`);
    }
    await client.end();
  } catch (e) {
    await client.end().catch(() => {});
    ng(label, `接続できるべきなのに失敗: ${e.code ?? ''} ${e.message.split('\n')[0]}`);
  }
}

/* 2〜3. 負: 信頼アンカーを外す / 別 root にすると拒否されること */
async function mustReject(label, ssl) {
  const client = new pg.Client({
    host: HOST, port: 6543, user: `postgres.${ref}`, password, database: 'postgres', ssl,
  });
  try {
    await client.connect();
    await client.end();
    ng(label, '接続できてしまった（検証が効いていない）');
  } catch (e) {
    await client.end().catch(() => {});
    ok(label, `想定どおり拒否: ${e.code ?? ''} ${e.message.split('\n')[0]}`);
  }
}

await mustReject('[負] OS 既定ストアのみ（私設 CA なので検証不能なはず）',
  { rejectUnauthorized: true });

const ca2025 = fs.readFileSync(path.resolve(__dirname, 'certs', 'prod-ca-2025.crt'), 'utf8');
await mustReject('[負] 別 root (prod-ca-2025) のみ信頼（現行チェーンは 2021 root 配下）',
  { ca: [ca2025], rejectUnauthorized: true });

/* 4. 名前検証: node が実際に使う checkServerIdentity を本物の leaf に当てる */
if (leafCert) {
  const good = tls.checkServerIdentity(HOST, leafCert);
  good === undefined
    ? ok('[名前検証] 正しいホスト名は受理', `${HOST} は SAN に一致`)
    : ng('[名前検証] 正しいホスト名が拒否された', good.message);

  const bad = tls.checkServerIdentity('evil.example.com', leafCert);
  bad !== undefined
    ? ok('[名前検証] 誤ったホスト名は拒否', `evil.example.com → ${bad.message}`)
    : ng('[名前検証] 誤ったホスト名が通ってしまった', 'ワイルドカードが広すぎる可能性');
} else {
  ng('[名前検証]', 'leaf 証明書を取得できずスキップ');
}

console.log(`\n--- 結果: ${failures === 0 ? '全て想定どおり ✅' : `${failures} 件が想定外 ❌`} ---`);
process.exitCode = failures === 0 ? 0 : 1;
