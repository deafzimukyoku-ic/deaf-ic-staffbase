/**
 * employee_handbook.pptx — 一般職員（employee）向け ハンドブック
 *
 * 設計:
 *   - 一般職員（ろう者）が「自分の画面」で何ができるかを眺めて分かる薄い資料
 *   - 視覚特化（CLAUDE.md §9）: 大きな絵文字 + 短い日本語 + スクショ枠
 *   - shift_station_card.pptx と同じスタイル（Teal Trust）
 */

const pptxgen = require('C:/Users/2han2/AppData/Local/Temp/pptx-build/node_modules/pptxgenjs');

const COLOR = {
  primary: '028090',
  primaryDark: '02575F',
  primaryLight: '00A896',
  accent: 'F4A261',
  red: 'C0392B',
  green: '27AE60',
  ink: '1F2937',
  inkLight: '6B7280',
  bg: 'F5F5F5',
  white: 'FFFFFF',
};

const FONT_HEAD = 'Cambria';
const FONT_BODY = 'Yu Gothic UI';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.title = '職員ステーション 使い方';
pres.author = '認定NPO法人 名古屋ろう国際センター';
pres.company = 'deaf-ic';

const W = 13.333;
const H = 7.5;
const TOTAL = 10;

function addTitleSlide(s) {
  s.background = { color: COLOR.primary };
  s.addText('👋', {
    x: 0, y: 1.0, w: W, h: 1.5,
    fontSize: 110, align: 'center', color: COLOR.white,
  });
  s.addText('職員ステーション 使い方', {
    x: 0, y: 2.7, w: W, h: 1.2,
    fontSize: 54, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });
  s.addText('〜 自分の画面でできること 〜', {
    x: 0, y: 4.0, w: W, h: 0.6,
    fontSize: 24, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });
  s.addText('認定NPO法人 名古屋ろう国際センター', {
    x: 0, y: 6.5, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white, italic: true,
  });
}

function addHeader(s, title, page) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: 0.55,
    fill: { color: COLOR.primary }, line: { type: 'none' },
  });
  s.addText(title, {
    x: 0.5, y: 0.7, w: W - 2, h: 0.8,
    fontSize: 32, bold: true, fontFace: FONT_HEAD,
    color: COLOR.ink,
  });
  s.addText(`${page} / ${TOTAL}`, {
    x: W - 1.6, y: 0.1, w: 1.4, h: 0.35,
    fontSize: 14, bold: true, fontFace: FONT_BODY,
    align: 'right', color: COLOR.white,
  });
}

/** スクショ枠（プレースホルダ）+ 右側に箇条書き */
function addScreenshotWithPoints(s, points, screenshotLabel = '📸 画面のイメージ') {
  s.addShape('roundRect', {
    x: 0.5, y: 1.9, w: 6.5, h: 4.8,
    fill: { color: COLOR.bg },
    line: { color: COLOR.inkLight, width: 1.5, dashType: 'dash' },
    rectRadius: 0.1,
  });
  s.addText(screenshotLabel, {
    x: 0.5, y: 1.9, w: 6.5, h: 4.8,
    fontSize: 18, fontFace: FONT_BODY,
    align: 'center', valign: 'middle', color: COLOR.inkLight, italic: true,
  });

  points.forEach((p, i) => {
    s.addText(p.icon, {
      x: 7.3, y: 2.0 + i * 0.95, w: 0.7, h: 0.7,
      fontSize: 28, align: 'center', color: COLOR.primary,
    });
    s.addText(p.text, {
      x: 8.0, y: 2.0 + i * 0.95, w: 4.8, h: 0.7,
      fontSize: 17, fontFace: FONT_BODY, valign: 'middle', color: COLOR.ink,
    });
  });
}

/* ---------------- 1. 表紙 ---------------- */
addTitleSlide(pres.addSlide());

/* ---------------- 2. ログイン ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '🔑 ログイン', '2');

  const steps = [
    { num: '1', title: 'URL を開く', body: 'スマホ・PC のブラウザで\n職員ステーションを開く' },
    { num: '2', title: 'メール + パスワード', body: '管理者から渡された\nメール・パスワードを入力' },
    { num: '3', title: 'ダッシュボード', body: '自分の名前が右上に\n表示されたらログイン成功' },
  ];

  steps.forEach((step, i) => {
    const x = 0.6 + i * 4.15;
    s.addShape('roundRect', {
      x, y: 1.9, w: 4.0, h: 4.4,
      fill: { color: COLOR.bg }, line: { color: COLOR.primary, width: 2 },
      rectRadius: 0.2,
    });
    s.addShape('ellipse', {
      x: x + 1.6, y: 2.1, w: 0.8, h: 0.8,
      fill: { color: COLOR.primary }, line: { type: 'none' },
    });
    s.addText(step.num, {
      x: x + 1.6, y: 2.1, w: 0.8, h: 0.8,
      fontSize: 28, bold: true, fontFace: FONT_HEAD,
      align: 'center', valign: 'middle', color: COLOR.white,
    });
    s.addText(step.title, {
      x, y: 3.1, w: 4.0, h: 0.7,
      fontSize: 22, bold: true, fontFace: FONT_HEAD,
      align: 'center', color: COLOR.ink,
    });
    s.addText(step.body, {
      x: x + 0.3, y: 3.9, w: 3.4, h: 2.0,
      fontSize: 16, fontFace: FONT_BODY,
      align: 'center', color: COLOR.inkLight,
    });
  });

  s.addText('💡 パスワードを忘れたら「パスワードを再設定」から', {
    x: 0.6, y: 6.6, w: 12.1, h: 0.5,
    fontSize: 16, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.primaryDark,
  });
}

/* ---------------- 3. ダッシュボード ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '🏠 ダッシュボード（最初の画面）', '3');
  addScreenshotWithPoints(s, [
    { icon: '🌟', text: '今日の自分のシフトが見える' },
    { icon: '📨', text: '新しいお知らせがあれば赤バッジ' },
    { icon: '📚', text: '未受講の研修があればここに出る' },
    { icon: '📜', text: '同意していない遵守事項も表示' },
    { icon: '👈', text: '左のメニューから各画面に移動' },
  ]);
}

/* ---------------- 4. 自分のシフトを見る ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '📅 自分のシフトを見る', '4');
  addScreenshotWithPoints(s, [
    { icon: '🟢', text: '公開されたシフトのみ表示される' },
    { icon: '📆', text: '月切替で前後の月を見られる' },
    { icon: '🕐', text: '出勤時間・休憩時間が確認できる' },
    { icon: '🚐', text: '送迎担当の日も自分の画面で見える' },
    { icon: '🔄', text: 'シフト変更したいときは「申請」から' },
  ]);
}

/* ---------------- 5. 休み希望を出す ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '🏖 休み希望を出す', '5');
  addScreenshotWithPoints(s, [
    { icon: '📅', text: '提出する月を選ぶ' },
    { icon: '🔴', text: '公休にしたい日 → 赤で印' },
    { icon: '🟡', text: '有給を取りたい日 → 黄で印' },
    { icon: '🟢', text: '出勤可能な日 → 緑で印（任意）' },
    { icon: '📤', text: '「提出」を押すとマネージャーに届く' },
  ]);

  s.addText('💡 提出後でも、締切前ならマネージャーに頼んで修正可能', {
    x: 0.5, y: 6.7, w: 12.3, h: 0.4,
    fontSize: 14, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.primaryDark,
  });
}

/* ---------------- 6. 遵守事項 ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '📜 遵守事項を見る・同意する', '6');
  addScreenshotWithPoints(s, [
    { icon: '📑', text: '法人の遵守事項が一覧で表示' },
    { icon: '👀', text: '本文を最後まで読む' },
    { icon: '✅', text: '読み終わったら「同意しました」をチェック' },
    { icon: '🔁', text: '内容が更新されたら、再度同意が必要になる' },
    { icon: '⏰', text: '同意していないものは赤マークで表示' },
  ]);
}

/* ---------------- 7. 研修を受ける ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '📚 研修を受ける', '7');
  addScreenshotWithPoints(s, [
    { icon: '📖', text: '研修一覧から受講するものを選ぶ' },
    { icon: '🎥', text: '本文 / 動画 / PDF を最後まで見る' },
    { icon: '✏️', text: '「受講した内容のまとめ」を 300 文字以上で記入' },
    { icon: '📤', text: '提出するとマネージャーが確認' },
    { icon: '✅', text: '合格判定が出ると「修了」マークが付く' },
  ]);
}

/* ---------------- 8. お知らせ ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '📢 お知らせを見る', '8');
  addScreenshotWithPoints(s, [
    { icon: '🆕', text: '新着には 🆕 バッジが付く' },
    { icon: '📂', text: 'カテゴリ（重要・連絡事項など）で分類' },
    { icon: '👁️', text: '開くと「既読」になる' },
    { icon: '🎯', text: '自分宛て（事業所・役職）のお知らせのみ表示' },
    { icon: '🔍', text: '過去のお知らせも検索できる' },
  ]);
}

/* ---------------- 9. 業務マニュアル ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '📖 業務マニュアルを見る', '9');
  addScreenshotWithPoints(s, [
    { icon: '📚', text: '業務マニュアル一覧' },
    { icon: '📂', text: 'カテゴリ別に整理されている' },
    { icon: '📄', text: 'PDF / 動画 / 本文 で読める' },
    { icon: '🔁', text: '何度でも繰り返し参照可' },
    { icon: '📍', text: '「このページに書いてあった」を覚えておくと便利' },
  ]);
}

/* ---------------- 10. 困ったら ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: COLOR.primaryDark };

  s.addText('💬', {
    x: 0, y: 1.2, w: W, h: 1.5,
    fontSize: 130, align: 'center', color: COLOR.white,
  });
  s.addText('困ったら', {
    x: 0, y: 2.9, w: W, h: 0.9,
    fontSize: 48, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });
  s.addShape('roundRect', {
    x: 3.0, y: 4.2, w: 7.3, h: 2.0,
    fill: { color: COLOR.white }, line: { type: 'none' },
    rectRadius: 0.2,
  });
  s.addText([
    { text: '🏢 マネージャー / 管理者へ\n', options: { fontSize: 22, bold: true, color: COLOR.primaryDark, fontFace: FONT_HEAD } },
    { text: '\n', options: { fontSize: 8 } },
    { text: 'LINE / 直接 — どの手段でも OK', options: { fontSize: 16, color: COLOR.inkLight, fontFace: FONT_BODY } },
  ], {
    x: 3.0, y: 4.2, w: 7.3, h: 2.0,
    align: 'center', valign: 'middle',
  });
  s.addText(`${TOTAL} / ${TOTAL}`, {
    x: 0, y: 7.0, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });
}

const out = './docs/manuals/employee_handbook.pptx';
pres.writeFile({ fileName: out }).then(() => {
  console.log('OK: ' + out);
});
