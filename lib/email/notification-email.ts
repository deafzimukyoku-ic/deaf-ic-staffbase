import type { LegacyNotificationContentType } from '@/lib/types';

const TYPE_LABEL: Record<LegacyNotificationContentType, string> = {
  announcement: 'お知らせ',
  compliance: '遵守事項',
  training: '研修',
  manual: '業務マニュアル',
};

const TYPE_PATH: Record<LegacyNotificationContentType, string> = {
  announcement: '/my/announcements',
  compliance: '/my/compliance',
  training: '/my/trainings',
  manual: '/my/manuals',
};

interface BuildArgs {
  contentType: LegacyNotificationContentType;
  title: string;
  bodySnippet?: string; // 200文字程度の抜粋（任意）
  companyName: string;
  appUrl: string; // https://…
}

export function buildNotificationEmail({ contentType, title, bodySnippet, companyName, appUrl }: BuildArgs) {
  const label = TYPE_LABEL[contentType];
  const link = `${appUrl.replace(/\/$/, '')}${TYPE_PATH[contentType]}`;
  const subject = `[${label}] ${title}`;

  const html = `
<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:24px 28px 16px;border-bottom:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:12px;color:#5a5a55;">${escapeHtml(companyName)}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#a8a8a0;">新しい${label}が投稿されました</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 8px;font-size:11px;color:#1a3eb8;font-weight:600;letter-spacing:0.05em;">${label.toUpperCase()}</p>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.5;">${escapeHtml(title)}</h1>
          ${bodySnippet ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#5a5a55;white-space:pre-wrap;">${escapeHtml(bodySnippet)}</p>` : ''}
          <a href="${link}" style="display:inline-block;background:#1a3eb8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">内容を確認する →</a>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:11px;color:#a8a8a0;">このメールは diletto StaffBase から自動送信されています。</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const text = `【${label}】${title}

${bodySnippet || ''}

内容を確認する: ${link}

---
${companyName}
このメールは diletto StaffBase から自動送信されています。`;

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
