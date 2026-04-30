/**
 * 招待メール（新規 + 再送信）の HTML テンプレ。
 * 認定NPO法人 名古屋ろう国際センター ブランド統一デザイン。
 *
 * 使い手:
 *   - app/api/employees/invite/route.ts
 *   - app/api/employees/resend-invite/route.ts
 */

interface BrandedInviteHtmlInput {
  company: string;
  employeeName: string;
  inviteLink: string;
  /** 再送信なら true（メール上部の文言が変わる）*/
  isResend?: boolean;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://deaf-ic-nagoya.org';

export function brandedInviteHtml({
  company,
  employeeName,
  inviteLink,
  isResend = false,
}: BrandedInviteHtmlInput): string {
  const headline = isResend ? '招待メール（再送信）' : '職員ステーションへの招待';
  const intro = isResend
    ? `${employeeName}さん<br>職員ステーションへの招待メールを再送信しました。<br>以下のボタンからパスワードを設定してログインしてください。`
    : `${employeeName}さん<br>${company}の職員ステーションへ招待されました。<br>以下のボタンからアカウントを有効化し、初回パスワードを設定してください。`;

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>${headline}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;color:#1a1a2e;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;">
      <div style="text-align:center;padding:32px 32px 0;">
        <img src="${SITE_URL}/logo.jpg" alt="認定NPO法人 名古屋ろう国際センター" style="height:64px;width:auto;border:0;" />
      </div>
      <div style="padding:24px 32px 40px;">
        <h1 style="margin:0 0 20px;font-size:20px;color:#1a1a2e;font-weight:700;text-align:center;">${headline}</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151;">${intro}</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${inviteLink}" style="display:inline-block;background:#4169e1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">招待を受け入れる</a>
        </div>
        <p style="margin:0 0 8px;font-size:12px;color:#6b7280;line-height:1.6;">
          ボタンが押せない場合は、以下の URL をブラウザに貼り付けてください：
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;font-family:'SF Mono','Consolas','Menlo',monospace;font-size:11px;line-height:1.6;color:#4169e1;word-break:break-all;overflow-wrap:anywhere;">
          ${inviteLink}
        </div>
      </div>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      このメールに心当たりがない場合は破棄してください。<br>
      認定NPO法人 名古屋ろう国際センター<br>
      職員ステーション
    </p>
  </div>
</body>
</html>`;
}
