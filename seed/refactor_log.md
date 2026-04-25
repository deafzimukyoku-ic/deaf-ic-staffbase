# 実装・修正ログ

## 2026-04-16 衝突と修正

### 状況報告
- 現象: `localhost:5000` でのログインページ表示および遷移の不具合。
- 原因: 前回の GitHub Pages 404 対処時に `next.config.ts` に追加した `basePath: '/diletto-shift-maker'` が、ローカル環境のルーティングとアセット読み込みに干渉し、デザイン崩れおよび `/dashboard` への遷移失敗を引き起こしていた。
- 対処: `next.config.ts` を元の設定にロールバックし、不適切であった GitHub Actions ワークフロー（`deploy.yml`）を削除。

### 変更点
- `next.config.ts`: `output: 'export'`, `basePath`, `unoptimized: true` を削除。
- `.github/workflows/deploy.yml`: 削除。
- `src/app/page.tsx`: 独自の実装であったランディングページの内容を削除し、`diletto-staffbase` と同様に `/login` へリダイレクトする処理に変更。
- `src/app/(app)/settings/staff/page.tsx`, `src/app/(app)/settings/children/page.tsx`: テーブルの行クリックで編集モーダルが開くようにし、不要となった「編集」ボタン列（操作列）を削除。
- 動作環境: ローカルホスト [http://localhost:5000](http://localhost:5000) にアクセスすると即座にログインページへ遷移するようになりました。

### 確認事項
- ログインページの遷移 (`/dashboard` への遷移) が復旧していることを確認してください。
- ログインページのデザインが期待通り（StaffBase側のデザインか、本プロジェクトの初期デザインか）であることをご確認ください。
