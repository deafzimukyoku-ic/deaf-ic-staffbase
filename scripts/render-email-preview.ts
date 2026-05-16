import { buildNotificationEmail } from '../lib/email/notification-email';
import { writeFileSync } from 'fs';

const types = ['announcement', 'compliance', 'training', 'manual'] as const;
const titles: Record<typeof types[number], string> = {
  announcement: '6月の研修日程変更について',
  compliance: '個人情報の取り扱いに関する規程改定',
  training: '虐待防止研修（必須）',
  manual: '送迎時の安全確認チェックリスト v2',
};

const labelJa: Record<typeof types[number], string> = {
  announcement: 'お知らせ',
  compliance: '遵守事項',
  training: '研修',
  manual: '業務マニュアル',
};

const sections = types.map(t => {
  const r = buildNotificationEmail({
    contentType: t,
    title: titles[t],
    companyName: '名古屋ろう国際センター',
    appUrl: 'https://deaf-ic.vercel.app',
  });
  const innerHtml = r.html
    .replace(/^[\s\S]*?<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*$/, '');
  return `
<section style="margin-bottom:48px;">
  <div style="font-family:sans-serif;font-size:12px;background:#222;color:#fff;padding:8px 12px;border-radius:4px 4px 0 0;">
    <strong>${labelJa[t]}</strong> &nbsp;&nbsp; 件名: ${r.subject}
  </div>
  <div style="border:1px solid #ddd;border-top:0;border-radius:0 0 4px 4px;">
    ${innerHtml}
  </div>
</section>`;
}).join('');

const wrap = `<!DOCTYPE html><html lang="ja"><body style="font-family:sans-serif;background:#eee;padding:24px;">
<h1 style="font-size:18px;">通知メール プレビュー（スニペット撤廃版）</h1>
<p style="color:#666;font-size:13px;">仕様書 修正2 適用後の見た目。本文は一切載せず、件名 + 「アプリで内容を確認する」CTA のみ。</p>
${sections}
</body></html>`;

writeFileSync('docs/email-preview.html', wrap);
console.log('Written: docs/email-preview.html');
