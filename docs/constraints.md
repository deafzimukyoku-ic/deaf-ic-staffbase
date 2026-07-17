# docs/constraints.md — deaf-ic プラットフォーム制約

このプロジェクトのホスティング・DB・外部サービスの「プラン / バージョン / クォータ / 既知の地雷」を固定する。
**「コードのバグに見えて環境制約が原因」というケースを早く特定するための一次資料。**

更新ルール:
- プラン・上限値・既知の地雷を発見したら追記する
- 上限値の数字は変動するため、迷ったら公式 docs で現行値を再確認
- 各 §は「制約」「根拠」「やってよい / やってはいけない」「破ったときの実害」を書く

---

## §1 動画・大容量静的アセットは Vercel Function を経由させない

### 制約

動画 (mp4 / webm) / PDF / 画像 / ZIP など、**サイズが大きい or サイズが不定のファイル**は Vercel Function (route handler / API route) で proxy / streaming しない。
具体的には `<video src="/api/foo/[id]">` のような Function 越しの配信を作らない。

### 根拠

- Vercel **Hobby プラン** の `Fast Origin Transfer` は **10 GB / 月** 上限 (2026-05 時点。`https://vercel.com/docs/limits` で現行値を要確認)。
  Function 経由で流したバイト数すべてがこの枠に計上される。
- Function は cold start ペナルティ (1〜数秒) + redirect chain + Range request 3 ホップが重なり、
  `<video>` の再生開始体感が 10 秒+ になる。
- `Cache-Control: 'private, max-age=300'` を付けると Vercel Edge にも乗らないため、毎回 origin を叩く。
- 同ページに複数 `<video preload="metadata">` があると Function 並列起動 →
  Hobby Function default timeout (10s) に近い遅延が観測される。

### やってよい

- YouTube / Google Drive / Vimeo など外部 CDN player へ **iframe 埋め込み or 別タブ遷移** で逃がす
- 静的アセット (画像・PDF 等で軽量なもの) を `public/` に置いて Vercel CDN から配信
- 認証付き Drive ファイル等は OAuth で Drive 直 URL を発行し、Function は **リダイレクトのみ** (バイトは流さない)

### やってはいけない

- `app/api/*-video/[id]/route.ts` のような **動画 proxy ルートを新設する**
- 大容量ファイルを `new Response(upstream.body)` で streaming する Function を作る
- Drive `uc?export=download` を Function で fetch して `<video>` に渡す (= 過去の対症療法。本制約に直接違反)

### 破ったときの実害

- Fast Origin Transfer 月上限 (10 GB) 突破で **月末 Function ロック** (= 全機能停止)
- 再生開始 10 秒+ で離脱率増
- `docs/error-log.md` 「Drive 動画読込が異常に遅い問題」(2026-05-26) が実例

### 関連 case

- 2026-05-19: Drive `/preview` iframe のモバイル UI 不具合を `<video>`+proxy で塞いだ判断 → 本制約に違反していた
- 2026-05-26: 上記を ▶サムネカード (Drive 別タブ遷移) で正しく解消、本 §1 を明文化

---

## §2 Supabase 接続は pooler 経由 + 証明書検証あり（`scripts/_db.mjs` 一本）

### 制約

Node.js スクリプトから Supabase に接続するときは **`scripts/_db.mjs` の `createPgClient()` を使う**。
`pg.Client` を各スクリプトで直接組み立てない。これは 2 つの制約を 1 か所で守るため:

1. **直接ホスト** `db.<ref>.supabase.co:5432` を使わない（pooler 経由）
2. **TLS 証明書検証を切らない**（`ssl.rejectUnauthorized:false` 禁止）

### 根拠

**1 (pooler)**: 直接ホストは IPv6 only。Windows 環境では IPv6 経路が不安定で接続失敗する。
pooler 経由なら IPv4 で安定接続できる。

**2 (証明書検証)**: pooler が提示するのは **Supabase の私設 CA チェーン**であって公的 CA ではない
（2026-07-17 実測）:

```
leaf: CN=*.pooler.supabase.com  (SAN: *.pooler.supabase.com, *.pooler.supabase.co)
  └─ CN=Supabase Intermediate 2021 CA
       └─ CN=Supabase Root 2021 CA   ← 自己署名。OS / Node の既定信頼ストアには入っていない
```

そのため `ca` を渡さずに `rejectUnauthorized:true` にすると `SELF_SIGNED_CERT_IN_CHAIN` で落ちる。
**「動かないから」と `rejectUnauthorized:false` に逃げると、この接続に流れる postgres スーパーユーザー
資格情報が中間者に対して無防備になる。** 正しい解は「検証を切る」ではなく「**信頼アンカーを明示する**」。

### やってよい

```js
import { createPgClient, loadEnv } from './_db.mjs';
const client = createPgClient();   // env 省略時は .env.local を読む
await client.connect();
```

`_db.mjs` の中身（＝この定型を変えるとき以外は触らない）:

| 項目 | 値 |
|---|---|
| host | `aws-1-ap-southeast-1.pooler.supabase.com` |
| port | `6543`（transaction mode） |
| user | `postgres.<project_ref>` |
| ssl | `{ ca: scripts/certs/*.crt, rejectUnauthorized: true }` |

- `rejectUnauthorized:true` + pg が付ける `servername=host` で **psql の `sslmode=verify-full` 相当**
  （pg は `ssl` を `Object.assign` した後に `servername = host` で上書きするため、
  呼び出し側から名前検証を弱められない）
- **CA は 2 本とも信頼する**。Supabase は **CN が同じまま鍵違いの root を再発行**する:

  | ファイル | 有効期限 | SHA-256 fingerprint |
  |---|---|---|
  | `scripts/certs/prod-ca-2021.crt` | 2021-04-28 〜 2031-04-26 | `80:70:25:AD:…:72:E6:CA:FA` |
  | `scripts/certs/prod-ca-2025.crt` | 2025-09-03 〜 2035-09-01 | `5F:9B:77:95:…:72:2C:9A:E2` |

  現行 pooler は 2021 root 配下だが、2025 root へ切り替わっても落ちないよう両方を信頼している
  （Supabase CLI も両方を embed している）。**将来 root が増えたら `scripts/certs/` に置くだけでよい**
  （`_db.mjs` はディレクトリ内の `*.crt` を全部読む）。

#### CA 証明書の入手元と置き場所

- 取得元は **Supabase Dashboard の「Download certificate」と同じ URL**
  （`apps/studio/hooks/custom-content/custom-content.json` の `ssl:certificate_url`）:
  ```
  https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
  ```
- **`.gitignore` しない**。CA は公開情報（秘密鍵ではない）であり、
  **信頼アンカーが git 差分でレビューできること自体が防御**になる。
  逆に gitignore すると clone 直後に検証できず「とりあえず切る」が再発する。
- 入れ替える際は **pooler が送ってきたチェーンをそのまま信頼しない**（= TOFU になり検証の意味が消える）。
  必ず上記 URL から公的 CA で検証された HTTPS 経由で取得し、fingerprint を上表と突き合わせる。

### やってはいけない

- `ssl: { rejectUnauthorized: false }` を書く（**理由を問わず禁止**）
- `NODE_TLS_REJECT_UNAUTHORIZED=0` を設定する（プロセス全体の検証が死ぬ・より悪い）
- `db.<ref>.supabase.co:5432` を `pg.Client({ host: ... })` に直書きする
- 各スクリプトで `pg.Client` を組み立て直す（`_db.mjs` を迂回する）

### 破ったときの実害

- **postgres スーパーユーザーの資格情報が中間者に露出**する。RLS を含む全テーブルの読み書き、
  Vault の secret 取得まで到達され得る（`scripts/verify-vault-secrets.mjs` が扱う情報がまさにそれ）
- 検証を切った接続は「暗号化されているが相手が誰か確かめていない」状態であり、
  盗聴に対しては無力（TLS の目的の半分を捨てている）

### 実証

`node scripts/probe-tls-verify.mjs` が根拠。成功例だけでなく **失敗すべきケース**も確認する:

| ケース | 期待 | 実測 (2026-07-17) |
|---|---|---|
| `certs/*.crt` を信頼 | 接続でき `authorized=true` | ✅ PostgreSQL 17.6 に接続 |
| OS 既定ストアのみ | 拒否 | ✅ `SELF_SIGNED_CERT_IN_CHAIN` |
| 別 root だけ信頼 | 拒否 | ✅ `SELF_SIGNED_CERT_IN_CHAIN` |
| 誤ったホスト名 | 拒否 | ✅ `Hostname/IP does not match certificate's altnames` |

証明書やチェーンを触ったら**必ずこれを流し直す**（全て ✅ でなければ検証は実質無効）。

---

## §3 (空き枠 — 追加時はここに platform-constraints スキル経由で追記)

将来追加候補:
- Anthropic API rate limit / 月額上限
- Resend (メール送信) クォータ
- Supabase 無料枠 (DB サイズ / Auth MAU / Storage GB / Edge Function 実行時間)
- Vercel Cron Hobby 制限 (1 日 1 回まで等) — 既に GitHub Actions cron に逃がし済 (`reference_deaf_ic_deployment.md` 参照)
