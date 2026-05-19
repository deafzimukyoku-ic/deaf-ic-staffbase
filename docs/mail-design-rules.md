# メールデザインルール (Canonical)

**このドキュメントは binding ルールである。あいまい表現は禁止。**
**メール HTML / text を編集する全コードは、編集前にこのドキュメントを読み、ルール準拠であることを確認すること。**

---

## 1. 適用範囲

`lib/email/` 配下の全テンプレート (両 repo 同じファイル名 / 構造):

| ファイル | 用途 | 送信元 (API) |
|---|---|---|
| `invite-html.ts`            | 招待・再送信メール | `app/api/employees/{invite,resend-invite}/route.ts` |
| `notification-email.ts`     | 新着お知らせ等の単発通知メール | `app/api/cron/send-notifications/route.ts` (legacy) |
| `digest-email.ts`           | 2h ウィンドウ集約 digest メール | `app/api/cron/send-notifications/route.ts` |
| `reminder-email.ts`         | 管理者リマインドメール | `app/api/admin/send-reminder/route.ts` |
| `issued-document-email.ts`  | 会社→社員 発行書類メール | `lib/issued-documents/issue-helper.ts` |
| `shift-notification-email.ts` | シフト公開・確定通知 | `app/api/notifications/manager-action/route.ts` 等 |

---

## 2. ブランド分離 (絶対)

| repo | ブランド表記 | ロゴ | ボタン主色 | ロゴアクセント色 |
|---|---|---|---|---|
| **deaf-ic** (`C:/Users/2han2/Projects/deaf-ic`) | `認定NPO法人 名古屋ろう国際センター` (フッターおよびロゴ alt は表記揺れなし) | `${NEXT_PUBLIC_SITE_URL}/logo.jpg` (image, `alt="認定NPO法人 名古屋ろう国際センター"`, `height:64px`) | `#4169e1` (royal blue) | (画像内に内包、別色指定なし) |
| **staffbase** (`C:/Users/2han2/Projects/diletto-new-staffbase`) | `diletto staffbase` (subject prefix・小文字・スペース 1 個・他綴り禁止) | テキストロゴ `di<em>letto</em> staff<span>base</span>` (image なし) | `#4169e1` (deaf-ic と同色。ボタンは共通) | `#5b7fff` (`letto` と `base` の文字色のみ) |

**禁止事項**:
- staffbase 内に `認定NPO`, `名古屋ろう`, `Nagoya Deaf`, `/logo.jpg` を書かない (= 過去のリーク再発防止)
- deaf-ic 内に `diletto`, `diletto-s.com`, テキスト di**letto** ロゴ を書かない
- 「いい感じ」「適当に」「だいたい」等のあいまい指示で実装しない (=本ドキュメント違反)

---

## 3. invite-html.ts (招待メール) — Canonical 構造

両 repo 共通の HTML 骨格。ブランド要素のみ swap。

```
<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>{headline}</title></head>
<body  background:#f5f5f7 / font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif / color:#1a1a2e>
  <div max-width:600px / 中央 / padding:32px 16px>
    <div white card / border-radius:12px / shadow:0 1px 3px rgba(0,0,0,0.08)>
      <div 中央 / padding:32px 32px 0>
        【LOGO スロット】※ §2 のブランドに従う
      </div>
      <div padding:24px 32px 40px>
        <h1 中央 / 20px / weight:700 / color:#1a1a2e>{headline}</h1>
        <p 14px / line-height:1.7 / color:#374151>{intro}</p>
        <div 中央 / margin:32px 0>
          <a href={inviteLink} background:{主色} / color:#fff / padding:14px 36px / radius:8px / weight:700>招待を受け入れる</a>
        </div>
        <p 12px / color:#6b7280>ボタンが押せない場合は、以下の URL をブラウザに貼り付けてください：</p>
        <div #f9fafb / border:1px solid #e5e7eb / radius:6px / padding:10px 12px / mono / 11px / color:{主色} / word-break:break-all>{inviteLink}</div>
      </div>
    </div>
    <p 中央 / 11px / color:#9ca3af / line-height:1.6>
      このメールに心当たりがない場合は破棄してください。<br>
      【FOOTER スロット】※ §2 のブランド表記に従う
    </p>
  </div>
</body></html>
```

### LOGO スロット
- **deaf-ic**: `<img src="${SITE_URL}/logo.jpg" alt="認定NPO法人 名古屋ろう国際センター" style="height:64px;width:auto;border:0;" />`
- **staffbase**: テキストロゴ (HTML/CSS のみ。画像 src 禁止)
  ```html
  <div style="font-size:22px;font-weight:800;letter-spacing:0.06em;color:#111;">
    di<em style="font-style:normal;color:#5b7fff;">letto</em>
    <span style="font-size:0.7em;font-weight:700;opacity:0.85;margin-left:0.4em;">staff<span style="color:#5b7fff;">base</span></span>
  </div>
  ```

### FOOTER スロット
- **deaf-ic**: `認定NPO法人 名古屋ろう国際センター<br>職員ステーション`
- **staffbase**: `diletto staffbase`

### コピーテキスト (固定)

#### Subject
- 新規招待: `【{company}】職員ステーションへの招待`
- 再送信:  `【{company}】職員ステーションへの招待（再送信）`

#### Headline (本文 h1)
- 新規招待: `職員ステーションへの招待`
- 再送信:   `招待メール（再送信）`

#### Intro (本文 p)
- 新規招待 (deaf-ic):  `{employeeName}さん<br>{company}の職員ステーションへ招待されました。<br>以下のボタンからアカウントを有効化し、初回パスワードを設定してください。`
- 新規招待 (staffbase): `{employeeName}さん<br>{company}の staffbase へ招待されました。<br>以下のボタンからアカウントを有効化し、初回パスワードを設定してください。`
- 再送信 (deaf-ic):    `{employeeName}さん<br>職員ステーションへの招待メールを再送信しました。<br>以下のボタンからパスワードを設定してログインしてください。`
- 再送信 (staffbase):  `{employeeName}さん<br>staffbase への招待メールを再送信しました。<br>以下のボタンからパスワードを設定してログインしてください。`

#### CTA Button text
固定: `招待を受け入れる`

---

## 4. その他のメール (notification/digest/reminder/issued-document/shift-notification)

§3 と同じ骨格 + 同じ LOGO/FOOTER スロット + 同じ主色を使用すること。各テンプレート固有のヘッドラインや本文だけ差し替える。**独自のレイアウト・色を導入してはならない**。

### 既知のテンプレ別仕様 (固定文)

#### digest-email.ts (集約 digest)
- Subject: `【{company}】新着まとめ`
- フッター追加文 (LOGO/FOOTER の上):
  - deaf-ic: `本文はアプリ内のみ表示されます。このメールは 名古屋ろう国際センター 職員ステーション から自動送信されています。`
  - staffbase: `本文はアプリ内のみ表示されます。このメールは diletto staffbase から自動送信されています。`

#### notification-email.ts (単発通知)
- Subject: 用途依存。`{company}` プレフィックス必須
- フッター追加文: digest と同形式 (`from 自動送信`)

#### reminder-email.ts (管理者リマインド)
- Subject: `【{company}】{categoryLabel} のリマインド`
- フッター追加文:
  - deaf-ic: `このメールは 名古屋ろう国際センター 職員ステーション から管理者が送信しました。`
  - staffbase: `このメールは diletto staffbase から管理者が送信しました。`

#### issued-document-email.ts (会社→社員 発行)
- Subject: `【{companyName}】{documentName} が届きました`
- フッター: `{companyName} 職員ステーション` (deaf-ic) / `{companyName}` (staffbase)

#### shift-notification-email.ts (シフト関連通知)
- Subject: 用途依存。`{company}` プレフィックス必須
- フッター: §3 と同形式

---

## 5. 変更プロトコル (必ず守る)

メール HTML/text を変更する全 PR で以下を実施:

1. **本ドキュメントを開いて読む** (commit message に「mail-design-rules.md L<行番号> 準拠」と明記)
2. **ブランド分離を侵してないか確認**: `grep -n "認定NPO\|名古屋ろう\|Nagoya Deaf\|/logo.jpg"` を staffbase で実行 → ヒット 0 件
3. **canonical 骨格 (§3) と一致しているか目視確認**
4. **ローカルで HTML プレビュー** (実際の Resend 送信ではなく、テンプレ文字列を HTML ファイルに書き出してブラウザで開く)
5. テスト送信 (`/admin/employees/new` で自分宛に招待 等) で表示崩れがないことを確認

---

## 6. 違反例 (絶対やらない)

- ❌ 「いい感じの NPO テイストに合わせる」 → ✅ §3 の HTML 骨格を一致させる
- ❌ 「色は青っぽく」 → ✅ ボタン主色は両 repo とも `#4169e1`、staffbase ロゴアクセントのみ `#5b7fff`。hex で固定
- ❌ 「ロゴは適当に大きく」 → ✅ deaf-ic image ロゴは `height:64px` を厳守
- ❌ Subject から `【{company}】` を省略 → ✅ 必ず prefix
- ❌ メール本文に `localhost` URL → ✅ `getAppUrl()` を経由する (`lib/app-url.ts`)
- ❌ staffbase ファイルに `認定NPO` を書く → ✅ `diletto staffbase` のみ

---

## 7. 緊急時の問い合わせ先

仕様が曖昧と感じたら **本ドキュメントを更新してから実装する**。
「ドキュメントが間違っていそう」と思っても勝手に解釈せず、ユーザーに確認を取った上で本ドキュメントを更新すること。本ドキュメントが Single Source of Truth である。
