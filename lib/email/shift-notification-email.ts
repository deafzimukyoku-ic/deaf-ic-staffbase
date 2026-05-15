/**
 * シフト関連の通知メールテンプレート
 *
 * - shift_ready: 該当 facility の employee 向け「仮シフト確認のお願い」
 * - shift_publish: NPO 全 admin 向け「シフト公開しました」
 */

interface BuildArgs {
  year: number;
  month: number;
  facilityName: string;
  publisherName: string; // 公開操作した admin/manager の名前
  publishedAt: string;   // ISO 8601
  appUrl: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatJpDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return iso;
  }
}

/** shift_publish: NPO 全 admin 向け公開通知 */
export function buildShiftPublishEmail(args: BuildArgs) {
  const { year, month, facilityName, publisherName, publishedAt, appUrl } = args;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const link = `${appUrl.replace(/\/$/, '')}/admin/shifts?month=${monthStr}`;

  const subject = `【シフト・送迎表公開】${year}年${month}月 ${facilityName}`;
  const text = [
    `${facilityName} の${year}年${month}月分の シフト表 と 送迎表 が公開されました。`,
    '',
    `対象月: ${year}年${month}月`,
    `公開者: ${publisherName}`,
    `公開日時: ${formatJpDateTime(publishedAt)}`,
    '',
    `シフト表 / 送迎表を確認: ${link}`,
    '',
    '・自分の勤務時間と送迎担当を必ず確認してください。',
    '・問題があれば「シフト変更申請」からご連絡ください。',
    '',
    'このメールはシステムから自動送信されています。',
  ].join('\n');

  const html = `<!DOCTYPE html><html lang="ja"><body style="margin:0;padding:0;background:#f5f4f0;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#111;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden;">
<tr><td style="padding:24px 28px 16px;border-bottom:1px solid rgba(0,0,0,0.08);">
<p style="margin:0 0 6px;font-size:11px;color:#0f766e;font-weight:600;letter-spacing:0.05em;">SHIFT &amp; TRANSPORT PUBLISHED</p>
<p style="margin:0;font-size:18px;font-weight:700;">${escapeHtml(facilityName)} のシフト・送迎表が公開されました</p>
</td></tr>
<tr><td style="padding:24px 28px;">
<table cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;">
<tr><td style="padding:4px 12px 4px 0;color:#5a5a55;width:90px;">対象月</td><td><strong>${year}年${month}月</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#5a5a55;">公開者</td><td>${escapeHtml(publisherName)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#5a5a55;">公開日時</td><td>${escapeHtml(formatJpDateTime(publishedAt))}</td></tr>
</table>
<ul style="margin:16px 0 0;padding-left:20px;font-size:13px;color:#5a5a55;line-height:1.7;">
<li>自分の勤務時間と送迎担当を必ず確認してください。</li>
<li>問題があれば「シフト変更申請」からご連絡ください。</li>
</ul>
<p style="margin:24px 0 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">シフト表 / 送迎表を確認する</a></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(0,0,0,0.06);font-size:11px;color:#a8a8a0;">このメールはシステムから自動送信されています。</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text };
}

/** shift_ready: 該当 facility の employee 向け仮シフト確認依頼 */
export function buildShiftReadyEmail(args: BuildArgs) {
  const { year, month, facilityName, appUrl } = args;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  /* /my/shifts は /my/requests?tab=facility-shift に統合済 (自分のシフト個別ページは撤廃) */
  const link = `${appUrl.replace(/\/$/, '')}/my/requests?tab=facility-shift&month=${monthStr}`;

  const subject = `【仮シフト・送迎表 確認のお願い】${year}年${month}月 ${facilityName}`;
  const text = [
    `${facilityName} の${year}年${month}月分の 仮シフト と 仮送迎表 が作成されました。`,
    '',
    '・ご自身の勤務予定（時間・休み）をご確認ください。',
    '・送迎担当（迎/送）の予定もあわせてご確認ください。',
    '・問題があれば「シフト変更申請」よりご連絡ください。',
    '',
    `確認: ${link}`,
    '',
    'このメールはシステムから自動送信されています。',
  ].join('\n');

  const html = `<!DOCTYPE html><html lang="ja"><body style="margin:0;padding:0;background:#f5f4f0;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#111;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden;">
<tr><td style="padding:24px 28px 16px;border-bottom:1px solid rgba(0,0,0,0.08);">
<p style="margin:0 0 6px;font-size:11px;color:#b45309;font-weight:600;letter-spacing:0.05em;">SHIFT &amp; TRANSPORT READY (TENTATIVE)</p>
<p style="margin:0;font-size:18px;font-weight:700;">仮シフト・送迎表の確認をお願いします</p>
</td></tr>
<tr><td style="padding:24px 28px;font-size:14px;line-height:1.7;">
<p style="margin:0 0 12px;">${escapeHtml(facilityName)} の <strong>${year}年${month}月 仮シフト と 仮送迎表</strong> が作成されました。</p>
<ul style="margin:12px 0;padding-left:20px;color:#5a5a55;">
<li>ご自身の勤務予定（時間・休み）をご確認ください。</li>
<li>送迎担当（迎/送）の予定もあわせてご確認ください。</li>
<li>問題があれば「シフト変更申請」よりご連絡ください。</li>
</ul>
<p style="margin:24px 0 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">仮シフト・送迎表を確認する</a></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(0,0,0,0.06);font-size:11px;color:#a8a8a0;">このメールはシステムから自動送信されています。</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text };
}
