/**
 * shift_station_card.pptx — シフト統括（事業所共用端末）向け簡易ガイド
 *
 * 設計:
 *   - 事業所のタブレット横に印刷掲示する想定
 *   - 1 ページ 1 メッセージ。大きな絵文字 + 短い日本語
 *   - ろう者向けの視覚特化（CLAUDE.md §9）: 音声依存ゼロ、色＋アイコン＋テキスト併用
 *   - カラーパレット: Teal Trust（信頼・落ち着き）
 */

const pptxgen = require('C:/Users/2han2/AppData/Local/Temp/pptx-build/node_modules/pptxgenjs');

const COLOR = {
  primary: '028090',     // teal
  primaryDark: '02575F',
  primaryLight: '00A896',
  accent: 'F4A261',      // 暖色アクセント（注意点で使う）
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
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inch
pres.title = 'シフト統括 端末ガイド';
pres.author = '認定NPO法人 名古屋ろう国際センター';
pres.company = 'deaf-ic';

const W = 13.333;
const H = 7.5;

/** タイトル + サブタイトル を中央に置く表紙パターン */
function addTitleSlide(s) {
  s.background = { color: COLOR.primary };

  // 上部の小さい絵文字バッジ
  s.addText('🏢', {
    x: 0, y: 1.2, w: W, h: 1.2,
    fontSize: 90, align: 'center', color: COLOR.white,
  });

  // メインタイトル
  s.addText('シフト統括 端末ガイド', {
    x: 0, y: 2.6, w: W, h: 1.2,
    fontSize: 54, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });

  // サブタイトル
  s.addText('事業所の共用タブレットでできること・できないこと', {
    x: 0, y: 4.0, w: W, h: 0.6,
    fontSize: 22, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });

  // フッター
  s.addText('認定NPO法人 名古屋ろう国際センター   |   職員ステーション', {
    x: 0, y: 6.5, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white, italic: true,
  });
}

/** 通常スライドの共通: 上部に色帯 + ページタイトル */
function addHeader(s, title, badge) {
  // 上部の細い色帯
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: 0.55,
    fill: { color: COLOR.primary },
    line: { type: 'none' },
  });

  // ページタイトル（左）
  s.addText(title, {
    x: 0.5, y: 0.7, w: W - 1, h: 0.8,
    fontSize: 32, bold: true, fontFace: FONT_HEAD,
    color: COLOR.ink,
  });

  // 右上のバッジ（章番号など）
  if (badge) {
    s.addText(badge, {
      x: W - 1.6, y: 0.1, w: 1.4, h: 0.35,
      fontSize: 14, bold: true, fontFace: FONT_BODY,
      align: 'right', color: COLOR.white,
    });
  }
}

/* ---------------- スライド 1: 表紙 ---------------- */
addTitleSlide(pres.addSlide());

/* ---------------- スライド 2: このアカウントは何？ ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '🪪 このアカウントは何？', '1 / 8');

  // 大きなアイコン左、説明右
  s.addShape('roundRect', {
    x: 0.6, y: 1.8, w: 4.5, h: 4.5,
    fill: { color: COLOR.primary }, line: { type: 'none' },
    rectRadius: 0.3,
  });
  s.addText('🌟', {
    x: 0.6, y: 2.4, w: 4.5, h: 2.0,
    fontSize: 140, align: 'center', color: COLOR.white,
  });
  s.addText('シフト統括', {
    x: 0.6, y: 4.7, w: 4.5, h: 0.7,
    fontSize: 32, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });
  s.addText('（事業所端末アカウント）', {
    x: 0.6, y: 5.4, w: 4.5, h: 0.5,
    fontSize: 16, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });

  // 右側説明
  const bullets = [
    '✅ 事業所ごとに 1 アカウント',
    '✅ 共用タブレットで使う想定',
    '✅ シフトと送迎の運用画面が見える',
    '⚠️ 個人情報・人事の編集はできない',
    '⚠️ お知らせ・研修・遵守事項の編集もできない',
  ];
  s.addText(
    bullets.map((b) => ({ text: b, options: { fontSize: 20, fontFace: FONT_BODY, color: COLOR.ink, paraSpaceAfter: 14, breakLine: true } })),
    { x: 5.6, y: 1.8, w: 7.2, h: 4.5, valign: 'middle' }
  );
}

/* ---------------- スライド 3: ログイン方法 ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '🔑 ログイン方法', '2 / 8');

  // 3 ステップ
  const steps = [
    { num: '1', title: 'URL を開く', body: '職員ステーションの URL を\nブラウザで開く' },
    { num: '2', title: 'メール + パスワード', body: '管理者から渡された\nメールアドレスとパスワードを入力' },
    { num: '3', title: 'ログイン完了', body: '「ダッシュボード」が\n表示されたらログイン成功' },
  ];

  steps.forEach((step, i) => {
    const x = 0.6 + i * 4.15;
    s.addShape('roundRect', {
      x, y: 1.9, w: 4.0, h: 4.4,
      fill: { color: COLOR.bg }, line: { color: COLOR.primary, width: 2 },
      rectRadius: 0.2,
    });
    // 番号バッジ
    s.addShape('ellipse', {
      x: x + 1.6, y: 2.1, w: 0.8, h: 0.8,
      fill: { color: COLOR.primary }, line: { type: 'none' },
    });
    s.addText(step.num, {
      x: x + 1.6, y: 2.1, w: 0.8, h: 0.8,
      fontSize: 28, bold: true, fontFace: FONT_HEAD,
      align: 'center', valign: 'middle', color: COLOR.white,
    });
    // タイトル
    s.addText(step.title, {
      x, y: 3.1, w: 4.0, h: 0.7,
      fontSize: 22, bold: true, fontFace: FONT_HEAD,
      align: 'center', color: COLOR.ink,
    });
    // 本文
    s.addText(step.body, {
      x: x + 0.3, y: 3.9, w: 3.4, h: 2.0,
      fontSize: 16, fontFace: FONT_BODY,
      align: 'center', color: COLOR.inkLight,
    });
  });

  // 注釈
  s.addText('💡 共用端末ではログアウト不要（次の人もそのまま使える）', {
    x: 0.6, y: 6.6, w: 12.1, h: 0.5,
    fontSize: 16, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.primaryDark,
  });
}

/* ---------------- スライド 4: できること ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '✅ できること', '3 / 8');

  // 2 列 × 4 行のグリッド
  const items = [
    { icon: '📅', label: '利用表',     desc: '児童の利用予定を見る' },
    { icon: '📋', label: 'シフト表',   desc: '職員の勤務予定を見る' },
    { icon: '🚐', label: '送迎表',     desc: '送迎担当を確認・印刷' },
    { icon: '📤', label: '日次出力',   desc: '今日の利用児童一覧' },
    { icon: '📝', label: '業務日報',   desc: '日報を印刷' },
    { icon: '💰', label: '利用料金表', desc: '月次の料金を印刷' },
    { icon: '👥', label: '同席日数',   desc: '職員×児童の同席日数' },
    { icon: '📨', label: '休み希望',   desc: '提出された休み希望を見る（閲覧のみ）' },
  ];

  items.forEach((item, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 0.4 + col * 3.2;
    const y = 1.85 + row * 2.5;

    s.addShape('roundRect', {
      x, y, w: 3.05, h: 2.3,
      fill: { color: COLOR.white },
      line: { color: COLOR.primaryLight, width: 2 },
      rectRadius: 0.15,
    });
    s.addText(item.icon, {
      x, y: y + 0.15, w: 3.05, h: 0.9,
      fontSize: 50, align: 'center', color: COLOR.primary,
    });
    s.addText(item.label, {
      x, y: y + 1.05, w: 3.05, h: 0.5,
      fontSize: 18, bold: true, fontFace: FONT_HEAD,
      align: 'center', color: COLOR.ink,
    });
    s.addText(item.desc, {
      x: x + 0.15, y: y + 1.55, w: 2.75, h: 0.7,
      fontSize: 12, fontFace: FONT_BODY,
      align: 'center', color: COLOR.inkLight,
    });
  });
}

/* ---------------- スライド 5: できないこと ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '⛔ できないこと（管理者に依頼）', '4 / 8');

  const items = [
    { icon: '👤', label: '職員の追加・退職',  why: '人事は管理者専用' },
    { icon: '🔄', label: 'ロールの変更',      why: '権限変更は管理者専用' },
    { icon: '🏢', label: '事業所の追加・編集', why: '組織変更は管理者専用' },
    { icon: '🏷️', label: 'カテゴリの作成・編集', why: 'マネージャーまでの権限' },
    { icon: '📜', label: '遵守事項の編集',    why: '法人ルールは管理者専用' },
    { icon: '📚', label: '研修・お知らせ・マニュアルの編集', why: '配信は管理者専用' },
  ];

  items.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.6 + col * 6.2;
    const y = 1.85 + row * 1.55;

    s.addShape('roundRect', {
      x, y, w: 6.05, h: 1.4,
      fill: { color: 'FCE8E6' },
      line: { color: COLOR.red, width: 1.5 },
      rectRadius: 0.12,
    });
    s.addText(item.icon, {
      x: x + 0.15, y: y + 0.2, w: 1.0, h: 1.0,
      fontSize: 42, align: 'center', color: COLOR.red,
    });
    s.addText(item.label, {
      x: x + 1.2, y: y + 0.15, w: 4.7, h: 0.55,
      fontSize: 18, bold: true, fontFace: FONT_HEAD,
      color: COLOR.ink,
    });
    s.addText(item.why, {
      x: x + 1.2, y: y + 0.7, w: 4.7, h: 0.6,
      fontSize: 13, fontFace: FONT_BODY,
      color: COLOR.inkLight,
    });
  });

  s.addText('💬 これらは LINE か直接、管理者に依頼してください', {
    x: 0.6, y: 6.7, w: 12.1, h: 0.5,
    fontSize: 16, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.red,
  });
}

/* ---------------- スライド 6: シフト表の見方 ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '📋 シフト表の見方', '5 / 8');

  // 左: スクショ枠（プレースホルダ）
  s.addShape('roundRect', {
    x: 0.5, y: 1.9, w: 6.5, h: 4.8,
    fill: { color: COLOR.bg },
    line: { color: COLOR.inkLight, width: 1.5, dashType: 'dash' },
    rectRadius: 0.1,
  });
  s.addText('📸 シフト表のスクリーンショット\n（後日差し込み）', {
    x: 0.5, y: 1.9, w: 6.5, h: 4.8,
    fontSize: 18, fontFace: FONT_BODY,
    align: 'center', valign: 'middle', color: COLOR.inkLight, italic: true,
  });

  // 右: 説明
  const points = [
    { icon: '📆', text: '上部の月をクリックして月切替' },
    { icon: '🟢', text: '「公開済」のシフトは緑バッジ' },
    { icon: '🟡', text: '「作成完了」は黄、「下書き」は灰' },
    { icon: '🔢', text: '日付の下の数字は当日利用人数' },
    { icon: '⏳', text: '「待 N」はキャンセル待ち件数' },
  ];
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

/* ---------------- スライド 7: 送迎表の見方 ---------------- */
{
  const s = pres.addSlide();
  addHeader(s, '🚐 送迎表の見方', '6 / 8');

  s.addShape('roundRect', {
    x: 0.5, y: 1.9, w: 6.5, h: 4.8,
    fill: { color: COLOR.bg },
    line: { color: COLOR.inkLight, width: 1.5, dashType: 'dash' },
    rectRadius: 0.1,
  });
  s.addText('📸 送迎表のスクリーンショット\n（後日差し込み）', {
    x: 0.5, y: 1.9, w: 6.5, h: 4.8,
    fontSize: 18, fontFace: FONT_BODY,
    align: 'center', valign: 'middle', color: COLOR.inkLight, italic: true,
  });

  const points = [
    { icon: '🟢', text: '緑のチップは送迎担当が決まっている児童' },
    { icon: '🔴', text: '赤枠は「担当未割当」（マネージャーが調整）' },
    { icon: '⏳', text: '「キャンセル待ち」は別セクションに表示' },
    { icon: '🖨', text: '「印刷」ボタンで A4 横で出力可' },
    { icon: '📅', text: '日付ナビで前後の日に切替' },
  ];
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

/* ---------------- スライド 8: 困ったら ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: COLOR.primaryDark };

  // 中央配置
  s.addText('💬', {
    x: 0, y: 1.2, w: W, h: 1.5,
    fontSize: 130, align: 'center', color: COLOR.white,
  });
  s.addText('困ったら', {
    x: 0, y: 2.9, w: W, h: 0.9,
    fontSize: 48, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });

  // 連絡先カード（プレースホルダ）
  s.addShape('roundRect', {
    x: 3.0, y: 4.2, w: 7.3, h: 2.0,
    fill: { color: COLOR.white }, line: { type: 'none' },
    rectRadius: 0.2,
  });
  s.addText([
    { text: '🏢 マネージャー or 管理者へ連絡\n', options: { fontSize: 22, bold: true, color: COLOR.primaryDark, fontFace: FONT_HEAD } },
    { text: '\n', options: { fontSize: 8 } },
    { text: 'LINE / 電話 / 直接 — どの手段でも OK', options: { fontSize: 16, color: COLOR.inkLight, fontFace: FONT_BODY } },
  ], {
    x: 3.0, y: 4.2, w: 7.3, h: 2.0,
    align: 'center', valign: 'middle',
  });

  s.addText('8 / 8', {
    x: 0, y: 7.0, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });
}

const out = './docs/manuals/shift_station_card.pptx';
pres.writeFile({ fileName: out }).then(() => {
  console.log('OK: ' + out);
});
