/* 173: 退職社員 (status='retired') 向け 書類発行メール。
   在籍社員は UI カードに表示するためメールは送らない (in_app)。
   reminder-email.ts のデザインを踏襲し、PDF 添付前提のため CTA は不要。 */

interface BuildArgs {
  employeeName: string;
  companyName: string;
  documentName: string;
  issuedByName: string;
  issuedAt: Date;
  message?: string | null;
}

export function buildIssuedDocumentEmail({
  employeeName,
  companyName,
  documentName,
  issuedByName,
  issuedAt,
  message,
}: BuildArgs) {
  const subject = `[${companyName}] ${documentName} のご送付`;
  const issuedAtJp = formatJp(issuedAt);
  const messageBlock = message?.trim();

  const html = `
<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:24px 28px 16px;border-bottom:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:12px;color:#5a5a55;">${escapeHtml(companyName)}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#a8a8a0;">書類の発行</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <h1 style="margin:0 0 12px;font-size:18px;font-weight:700;line-height:1.5;">${escapeHtml(employeeName)} 様</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#5a5a55;">
            お世話になっております。<br>
            添付の書類「<strong>${escapeHtml(documentName)}</strong>」をお送りします。
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:13px;color:#333;">
            <tr><td style="padding:2px 12px 2px 0;color:#888;">発行者</td><td>${escapeHtml(issuedByName)}</td></tr>
            <tr><td style="padding:2px 12px 2px 0;color:#888;">発行日時</td><td>${escapeHtml(issuedAtJp)}</td></tr>
          </table>
          ${
            messageBlock
              ? `<div style="margin:0 0 16px;padding:12px 14px;background:#f7f6f1;border-radius:6px;font-size:13px;line-height:1.7;color:#444;white-space:pre-wrap;">${escapeHtml(messageBlock)}</div>`
              : ''
          }
          <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#9b3333;">
            ※ 本メールは送信専用です。返信はできません。<br>
            ※ 添付 PDF は厳重に保管いただき、不要になった場合は削除をお願いします。
          </p>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:11px;color:#a8a8a0;">${escapeHtml(companyName)} 職員ステーション</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const text = `${employeeName} 様

お世話になっております。
添付の書類「${documentName}」をお送りします。

発行者: ${issuedByName}
発行日時: ${issuedAtJp}
${messageBlock ? `\n${messageBlock}\n` : ''}
※ 本メールは送信専用です。返信はできません。
※ 添付 PDF は厳重に保管いただき、不要になった場合は削除をお願いします。

---
${companyName} 職員ステーション`;

  return { subject, html, text };
}

function formatJp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
