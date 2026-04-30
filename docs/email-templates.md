# Supabase Auth メールテンプレート

認定NPO法人名古屋ろう国際センター用のブランド HTML メールテンプレ集。
Supabase Dashboard → **Authentication → Email Templates** で各テンプレートにコピペする。

---

## 0. 事前準備：Resend を Supabase の SMTP として接続

Supabase 標準 SMTP は **3通/時 × 100通/日** 制限。本番運用前に Resend SMTP に切替えること。

### 手順
1. **Resend Dashboard → API Keys** で新しい SMTP 用キーを発行（`Sending Access` 権限）
2. **Supabase Dashboard → Project Settings → Authentication → SMTP Settings** を開く
3. **Enable Custom SMTP** を ON
4. 以下を入力：
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: `（発行した API key を貼る）`
   - Sender email: `noreply@deaf-ic-nagoya.org`
   - Sender name: `名古屋ろう国際センター`
5. **Save** → Resend 側で `deaf-ic-nagoya.org` ドメイン認証（SPF/DKIM）が済んでいないとここで弾かれる
   - Resend → **Domains → Add Domain** → DNS レコード（Vercel DNS で発行可能）追加 → Verify
6. テスト送信して届くか確認

---

## 1. 共通デザイン仕様

- **幅**: 600px max
- **ヘッダー色**: `#1a1a2e`（ダークネイビー = メインブランド）
- **アクセント色**: `#4169e1`（ロイヤルブルー = CTA ボタン）
- **背景**: `#f5f5f7`
- **カード**: 白、角丸 12px、薄影
- **ロゴ**: `https://deaf-ic-nagoya.org/logo.jpg`（高さ 60px）
- **フォント**: システムフォント（Hiragino, Yu Gothic 等）

メール変数（Supabase）：
| 記法 | 内容 |
|---|---|
| `{{ .ConfirmationURL }}` | 認証 URL（ボタンに埋める） |
| `{{ .Email }}` | 受信者メールアドレス |
| `{{ .NewEmail }}` | 変更後メールアドレス（Change Email 専用）|
| `{{ .Token }}` | 6 桁 OTP（Reauthentication 等）|
| `{{ .SiteURL }}` | 設定済 Site URL |

---

## 2. Confirm signup（新規登録の確認）

**Subject**: `【名古屋ろう国際センター】メールアドレスのご確認`

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>メール確認</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;color:#1a1a2e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://deaf-ic-nagoya.org/logo.jpg" alt="名古屋ろう国際センター" style="height:60px;width:auto;border:0;" />
    </div>
    <div style="background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h1 style="margin:0 0 20px;font-size:20px;color:#1a1a2e;font-weight:700;">メールアドレスのご確認</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151;">
        職員ステーションへのご登録ありがとうございます。<br>
        以下のボタンをクリックしてメールアドレスを確認してください。
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#4169e1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">メールアドレスを確認</a>
      </div>
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
        ボタンが押せない場合は、以下の URL をブラウザに貼り付けてください：<br>
        <span style="word-break:break-all;color:#4169e1;">{{ .ConfirmationURL }}</span>
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      このメールに心当たりがない場合は破棄してください。<br>
      認定NPO法人 名古屋ろう国際センター<br>
      職員ステーション
    </p>
  </div>
</body>
</html>
```

---

## 3. Invite user（職員招待）

**Subject**: `【名古屋ろう国際センター】職員ステーションへの招待`

> **注**: 現在のシステムは [/api/employees/invite](../app/api/employees/invite/route.ts) から **Resend API 直送** で独自 HTML を送っている（Supabase の招待メールは経由しない）。このテンプレは Supabase 経由フォールバック用。

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>招待</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;color:#1a1a2e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://deaf-ic-nagoya.org/logo.jpg" alt="名古屋ろう国際センター" style="height:60px;width:auto;border:0;" />
    </div>
    <div style="background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h1 style="margin:0 0 20px;font-size:20px;color:#1a1a2e;font-weight:700;">職員ステーションへの招待</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151;">
        認定NPO法人 名古屋ろう国際センターの職員ステーションへ招待されました。<br>
        以下のボタンからアカウントを有効化し、初回パスワードを設定してください。
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#4169e1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">招待を受け入れる</a>
      </div>
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
        ボタンが押せない場合は、以下の URL をブラウザに貼り付けてください：<br>
        <span style="word-break:break-all;color:#4169e1;">{{ .ConfirmationURL }}</span>
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      このメールに心当たりがない場合は破棄してください。<br>
      認定NPO法人 名古屋ろう国際センター<br>
      職員ステーション
    </p>
  </div>
</body>
</html>
```

---

## 4. Magic link（マジックリンクログイン）

**Subject**: `【名古屋ろう国際センター】ログインリンク`

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>ログインリンク</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;color:#1a1a2e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://deaf-ic-nagoya.org/logo.jpg" alt="名古屋ろう国際センター" style="height:60px;width:auto;border:0;" />
    </div>
    <div style="background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h1 style="margin:0 0 20px;font-size:20px;color:#1a1a2e;font-weight:700;">ログインリンク</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151;">
        以下のボタンをクリックすると、パスワードを入力せずにログインできます。<br>
        このリンクは 1 時間有効で、1 度だけ使用できます。
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#4169e1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">ログインする</a>
      </div>
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
        ボタンが押せない場合は、以下の URL をブラウザに貼り付けてください：<br>
        <span style="word-break:break-all;color:#4169e1;">{{ .ConfirmationURL }}</span>
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      このログインリンクをリクエストした覚えがない場合は破棄してください。<br>
      認定NPO法人 名古屋ろう国際センター
    </p>
  </div>
</body>
</html>
```

---

## 5. Change email address（メールアドレス変更確認）

**Subject**: `【名古屋ろう国際センター】メールアドレス変更のご確認`

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>メールアドレス変更確認</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;color:#1a1a2e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://deaf-ic-nagoya.org/logo.jpg" alt="名古屋ろう国際センター" style="height:60px;width:auto;border:0;" />
    </div>
    <div style="background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h1 style="margin:0 0 20px;font-size:20px;color:#1a1a2e;font-weight:700;">メールアドレス変更のご確認</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151;">
        ログイン用のメールアドレスを以下に変更するリクエストを受け付けました。
      </p>
      <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin:20px 0;font-size:13px;line-height:1.8;">
        <div><span style="color:#9ca3af;">変更前：</span><span style="color:#1a1a2e;font-weight:600;">{{ .Email }}</span></div>
        <div><span style="color:#9ca3af;">変更後：</span><span style="color:#1a1a2e;font-weight:600;">{{ .NewEmail }}</span></div>
      </div>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151;">
        以下のボタンをクリックして変更を確定してください。
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#4169e1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">変更を確定する</a>
      </div>
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
        ボタンが押せない場合は、以下の URL をブラウザに貼り付けてください：<br>
        <span style="word-break:break-all;color:#4169e1;">{{ .ConfirmationURL }}</span>
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      心当たりがない場合は破棄してください（変更は確定されません）。<br>
      認定NPO法人 名古屋ろう国際センター
    </p>
  </div>
</body>
</html>
```

---

## 6. Reset password（パスワードリセット）

**Subject**: `【名古屋ろう国際センター】パスワードの再設定`

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>パスワード再設定</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;color:#1a1a2e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://deaf-ic-nagoya.org/logo.jpg" alt="名古屋ろう国際センター" style="height:60px;width:auto;border:0;" />
    </div>
    <div style="background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h1 style="margin:0 0 20px;font-size:20px;color:#1a1a2e;font-weight:700;">パスワードの再設定</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151;">
        パスワード再設定のリクエストを受け付けました。<br>
        以下のボタンから新しいパスワードを設定してください。
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#4169e1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">パスワードを再設定</a>
      </div>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;line-height:1.6;">
        ボタンが押せない場合は、以下の URL をブラウザに貼り付けてください：<br>
        <span style="word-break:break-all;color:#4169e1;">{{ .ConfirmationURL }}</span>
      </p>
      <p style="margin:0;font-size:12px;color:#dc2626;line-height:1.6;font-weight:600;">
        ※ このリンクは 1 時間で失効します。
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      心当たりがない場合は破棄してください（パスワードは変更されません）。<br>
      認定NPO法人 名古屋ろう国際センター
    </p>
  </div>
</body>
</html>
```

---

## 7. Reauthentication（再認証コード）

**Subject**: `【名古屋ろう国際センター】認証コード`

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>認証コード</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;color:#1a1a2e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://deaf-ic-nagoya.org/logo.jpg" alt="名古屋ろう国際センター" style="height:60px;width:auto;border:0;" />
    </div>
    <div style="background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <h1 style="margin:0 0 20px;font-size:20px;color:#1a1a2e;font-weight:700;">認証コード</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#374151;">
        重要な操作の確認のため、以下の認証コードを画面に入力してください。
      </p>
      <div style="background:#f9fafb;border:2px solid #4169e1;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
        <div style="font-size:32px;font-weight:700;letter-spacing:0.3em;color:#4169e1;font-family:'Courier New',monospace;">
          {{ .Token }}
        </div>
      </div>
      <p style="margin:0;font-size:12px;color:#dc2626;line-height:1.6;font-weight:600;text-align:center;">
        このコードは 60 秒で失効します。
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      心当たりがない場合は破棄してください。<br>
      認定NPO法人 名古屋ろう国際センター
    </p>
  </div>
</body>
</html>
```

---

## 8. ロゴ画像について

メール本文の `<img src="https://deaf-ic-nagoya.org/logo.jpg" />` は本番ドメインを参照する。

**ロゴ差替手順**：
1. 新ロゴ画像を `public/logo.jpg`（同名で上書き、または PNG なら `public/logo.png`）に配置
2. テンプレ内 6 箇所の `src` を新パスに合わせる
3. Supabase Dashboard で各テンプレを再保存

**サイズ目安**：横長 240×60px、または正方形 80×80px。Retina 対応で 2x（480×120px）の画像を `style="height:60px"` で表示すると綺麗。

---

## 9. 反映確認

各テンプレを Supabase に保存したら：
1. テスト用ユーザーで「パスワードを忘れた場合」など実行
2. Resend Dashboard → **Logs** で送信ログを確認
3. 受信メールでロゴ・ボタン・リンクが期待通りか確認
