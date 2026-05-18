/* 175-B: 「2h ウィンドウ digest」メール
   同じ社員宛に複数の新着通知 (お知らせ / 遵守事項 / 研修 / 業務マニュアル) を
   1 通にまとめて送るためのテンプレート。

   cron 側で「scheduled_at <= now の未送信キュー」を社員ごとにグループ化して、
   このメール 1 通だけを送る。本文はアプリ内のみ表示 (notification-email.ts と同じ方針)。 */

import type { LegacyNotificationContentType } from '@/lib/types';

const CATEGORY_LABEL: Record<LegacyNotificationContentType, string> = {
  announcement: 'お知らせ',
  compliance: '遵守事項',
  training: '研修',
  manual: '業務マニュアル',
};

const CATEGORY_PATH: Record<LegacyNotificationContentType, string> = {
  announcement: '/my/announcements',
  compliance: '/my/compliance',
  training: '/my/trainings',
  manual: '/my/manuals',
};

const CATEGORY_ORDER: LegacyNotificationContentType[] = [
  'announcement',
  'compliance',
  'training',
  'manual',
];

export interface DigestItem {
  contentType: LegacyNotificationContentType;
  title: string;
}

interface BuildArgs {
  companyName: string;
  appUrl: string;
  items: DigestItem[];
}

export function buildDigestEmail({ companyName, appUrl, items }: BuildArgs) {
  const base = appUrl.replace(/\/$/, '');

  /* カテゴリ別にグループ化 (CATEGORY_ORDER の並びを保つ) */
  const byCategory = new Map<LegacyNotificationContentType, DigestItem[]>();
  for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
  for (const item of items) byCategory.get(item.contentType)?.push(item);

  /* 件名: 1 件なら従来同様、複数なら集約 */
  const totalCount = items.length;
  let subject: string;
  if (totalCount === 1) {
    const it = items[0];
    subject = `[${CATEGORY_LABEL[it.contentType]}] ${it.title}`;
  } else {
    const breakdown = CATEGORY_ORDER
      .filter((cat) => (byCategory.get(cat)?.length ?? 0) > 0)
      .map((cat) => `${CATEGORY_LABEL[cat]} ${byCategory.get(cat)!.length}`)
      .join(' / ');
    subject = `[${companyName}] 新着 ${totalCount} 件のお知らせ (${breakdown})`;
  }

  /* HTML セクション (カテゴリごとに小見出し + 箇条書き + リンク) */
  const sectionsHtml = CATEGORY_ORDER
    .filter((cat) => (byCategory.get(cat)?.length ?? 0) > 0)
    .map((cat) => {
      const list = byCategory.get(cat)!;
      const link = `${base}${CATEGORY_PATH[cat]}`;
      const lis = list
        .map((it) => `<li style="margin:4px 0;line-height:1.5;">${escapeHtml(it.title)}</li>`)
        .join('');
      return `
        <div style="margin:0 0 20px;">
          <div style="display:flex;align-items:baseline;gap:8px;margin:0 0 6px;">
            <span style="font-size:11px;color:#1a3eb8;font-weight:600;letter-spacing:0.05em;">${CATEGORY_LABEL[cat].toUpperCase()}</span>
            <span style="font-size:11px;color:#a8a8a0;">${list.length} 件</span>
          </div>
          <ul style="margin:0;padding:0 0 0 18px;font-size:14px;color:#1f2937;">${lis}</ul>
          <p style="margin:8px 0 0;"><a href="${link}" style="font-size:12px;color:#1a3eb8;text-decoration:underline;">${CATEGORY_LABEL[cat]}を開く →</a></p>
        </div>
      `;
    })
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:24px 28px 16px;border-bottom:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:12px;color:#5a5a55;">${escapeHtml(companyName)}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#a8a8a0;">新着 ${totalCount} 件のお知らせ</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          ${sectionsHtml}
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(0,0,0,0.08);">
          <p style="margin:0;font-size:11px;color:#a8a8a0;">本文はアプリ内のみ表示されます。このメールは 名古屋ろう国際センター 職員ステーション から自動送信されています。</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const textSections = CATEGORY_ORDER
    .filter((cat) => (byCategory.get(cat)?.length ?? 0) > 0)
    .map((cat) => {
      const list = byCategory.get(cat)!;
      const link = `${base}${CATEGORY_PATH[cat]}`;
      const lines = list.map((it) => `  - ${it.title}`).join('\n');
      return `■ ${CATEGORY_LABEL[cat]} (${list.length} 件)\n${lines}\n  → ${link}`;
    })
    .join('\n\n');

  const text = `${companyName} より、下記の新着があります。アプリで内容をご確認ください。

${textSections}

---
${companyName}
このメールは 名古屋ろう国際センター 職員ステーション から自動送信されています。`;

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
