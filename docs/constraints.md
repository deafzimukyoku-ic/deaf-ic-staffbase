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

## §2 Supabase 接続は pooler 経由 (直接ホスト IPv6-only)

### 制約

Node.js スクリプト・ローカル `psql` 等から Supabase に接続するとき、**直接ホスト**
`db.<ref>.supabase.co:5432` は **使用しない**。

### 根拠

直接ホストは IPv6 only。Windows 環境では IPv6 経路が不安定で接続失敗する。
pooler 経由なら IPv4 で安定接続できる。

### やってよい

```
host: aws-1-ap-southeast-1.pooler.supabase.com
port: 6543 (transaction mode pooler)
user: postgres.<project_ref>
```

`scripts/apply-migration-*.mjs` 系は全てこの形式で書かれている。新規スクリプトもこれを踏襲。

### やってはいけない

`db.<ref>.supabase.co:5432` を `pg.Client({ host: ... })` に直書きする。

---

## §3 (空き枠 — 追加時はここに platform-constraints スキル経由で追記)

将来追加候補:
- Anthropic API rate limit / 月額上限
- Resend (メール送信) クォータ
- Supabase 無料枠 (DB サイズ / Auth MAU / Storage GB / Edge Function 実行時間)
- Vercel Cron Hobby 制限 (1 日 1 回まで等) — 既に GitHub Actions cron に逃がし済 (`reference_deaf_ic_deployment.md` 参照)
