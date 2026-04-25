export type ReminderCategory = 'documents' | 'compliance' | 'training' | 'announcements' | 'manuals';

const CATEGORY_LABEL: Record<ReminderCategory, string> = {
  documents: '書類提出',
  compliance: '遵守事項の確認',
  training: '研修の受講',
  announcements: 'お知らせの確認',
  manuals: '業務マニュアルの確認',
};

const CATEGORY_PATH: Record<ReminderCategory, string> = {
  documents: '/my/documents',
  compliance: '/my/compliance',
  training: '/my/trainings',
  announcements: '/my/announcements',
  manuals: '/my/manuals',
};

interface BuildArgs {
  category: ReminderCategory;
  employeeName: string;
  companyName: string;
  appUrl: string;
}

export function buildReminderEmail({ category, employeeName, companyName, appUrl }: BuildArgs) {
  const label = CATEGORY_LABEL[category];
  const link = `${appUrl.replace(/\/$/, '')}${CATEGORY_PATH[category]}`;
  const subject = `[リマインド] ${label}をお願いします`;

  const html = `
<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:24px 28px 16px;border-bottom:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:12px;color:#5a5a55;">${escapeHtml(companyName)}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#a8a8a0;">未完了のお知らせ</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 8px;font-size:11px;color:#9b3333;font-weight:600;letter-spacing:0.05em;">REMINDER</p>
          <h1 style="margin:0 0 12px;font-size:18px;font-weight:700;line-height:1.5;">${escapeHtml(employeeName)} さん</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#5a5a55;">
            ${escapeHtml(label)}がまだ完了していません。<br>
            お手数ですが、以下のリンクから確認をお願いします。
          </p>
          <a href="${link}" style="display:inline-block;background:#1a3eb8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">${escapeHtml(label)}を開く →</a>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:11px;color:#a8a8a0;">このメールは diletto StaffBase から管理者が送信しました。</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const text = `【リマインド】${label}をお願いします

${employeeName} さん

${label}がまだ完了していません。
お手数ですが、以下のリンクから確認をお願いします。

${link}

---
${companyName}
このメールは diletto StaffBase から管理者が送信しました。`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
