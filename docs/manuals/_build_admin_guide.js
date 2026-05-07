/**
 * admin_guide.pptx — 管理者（admin）向け 運用マニュアル
 *
 * 設計:
 *   - 法人本部の管理者向け。事業所追加 / 職員招待 / ロール変更 / アクセス権限 / 人事評価活用
 *   - 20 枚構成。第 6 章「人事評価への活用」は別カラーでセクション化
 *   - shift_station_card / manager_guide と同じスタイル（Teal Trust）
 */

const pptxgen = require('C:/Users/2han2/AppData/Local/Temp/pptx-build/node_modules/pptxgenjs');

const COLOR = {
  primary: '028090',
  primaryDark: '02575F',
  primaryLight: '00A896',
  accent: 'F4A261',
  red: 'C0392B',
  green: '27AE60',
  // 人事評価章用（落ち着いたパープル）
  hr: '6D2E46',
  hrLight: 'F5E5EC',
  ink: '1F2937',
  inkLight: '6B7280',
  bg: 'F5F5F5',
  white: 'FFFFFF',
};

const FONT_HEAD = 'Cambria';
const FONT_BODY = 'Yu Gothic UI';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.title = '管理者運用マニュアル';
pres.author = '認定NPO法人 名古屋ろう国際センター';
pres.company = 'deaf-ic';

const W = 13.333;
const TOTAL = 20;

function addTitleSlide(s) {
  s.background = { color: COLOR.primaryDark };
  s.addText('🏛', {
    x: 0, y: 1.0, w: W, h: 1.5,
    fontSize: 110, align: 'center', color: COLOR.white,
  });
  s.addText('管理者運用マニュアル', {
    x: 0, y: 2.7, w: W, h: 1.2,
    fontSize: 54, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });
  s.addText('〜 法人運営・人材管理・人事評価への活用 〜', {
    x: 0, y: 4.0, w: W, h: 0.6,
    fontSize: 22, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });
  s.addText('認定NPO法人 名古屋ろう国際センター', {
    x: 0, y: 6.5, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white, italic: true,
  });
}

function addHeader(s, title, page, sectionColor = COLOR.primary) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: 0.55,
    fill: { color: sectionColor }, line: { type: 'none' },
  });
  s.addText(title, {
    x: 0.5, y: 0.7, w: W - 2, h: 0.8,
    fontSize: 30, bold: true, fontFace: FONT_HEAD,
    color: COLOR.ink,
  });
  s.addText(`${page} / ${TOTAL}`, {
    x: W - 1.6, y: 0.1, w: 1.4, h: 0.35,
    fontSize: 14, bold: true, fontFace: FONT_BODY,
    align: 'right', color: COLOR.white,
  });
}

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
      fontSize: 26, align: 'center', color: COLOR.primary,
    });
    s.addText(p.text, {
      x: 8.0, y: 2.0 + i * 0.95, w: 4.8, h: 0.85,
      fontSize: 16, fontFace: FONT_BODY, valign: 'middle', color: COLOR.ink,
    });
  });
}

let pageNo = 0;
function newSlide(title, sectionColor) {
  pageNo++;
  const s = pres.addSlide();
  addHeader(s, title, pageNo, sectionColor);
  return s;
}

/** セクション扉スライド */
function addSectionDivider(label, jpTitle, bgColor) {
  pageNo++;
  const s = pres.addSlide();
  s.background = { color: bgColor };
  s.addText(label, {
    x: 0, y: 2.5, w: W, h: 1.0,
    fontSize: 24, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white, italic: true,
  });
  s.addText(jpTitle, {
    x: 0, y: 3.4, w: W, h: 1.5,
    fontSize: 60, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });
  s.addText(`${pageNo} / ${TOTAL}`, {
    x: 0, y: 7.0, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });
  return s;
}

/* ---- 1. 表紙 ---- */
addTitleSlide(pres.addSlide());
pageNo = 1;

/* ---- 2. 管理者の役割 ---- */
{
  const s = newSlide('🏛 管理者の役割（admin）');
  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 12.1, h: 4.9,
    fill: { color: 'E6F4F1' }, line: { color: COLOR.green, width: 2 }, rectRadius: 0.15,
  });
  s.addText('全ての権限を持つ法人本部担当', {
    x: 0.6, y: 1.95, w: 12.1, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.green,
  });
  const cols = [
    [
      '🏢 事業所の追加・編集・削除',
      '👤 職員の招待・退職処理',
      '🔄 ロールの変更（admin / manager / employee）',
      '🪪 シフト統括アカウントの発行',
      '🔐 アクセス権限マトリクスの設定',
    ],
    [
      '📢 全事業所のお知らせ・研修・マニュアル管理',
      '📜 法人の遵守事項の編集',
      '🏷 全カテゴリの管理',
      '📊 全事業所のシフト・送迎・利用料金表',
      '🤖 AI 診断結果の閲覧（manager と共通）',
    ],
  ];
  cols.forEach((items, ci) => {
    items.forEach((item, i) => {
      s.addText(item, {
        x: 1.0 + ci * 6.0, y: 2.7 + i * 0.85, w: 5.6, h: 0.8,
        fontSize: 16, fontFace: FONT_BODY, valign: 'middle', color: COLOR.ink,
      });
    });
  });
}

/* ---- 3. 法人 (tenant) 設定 ---- */
{
  const s = newSlide('🏛 法人（tenant）設定');
  addScreenshotWithPoints(s, [
    { icon: '🏢', text: '法人名・住所・連絡先' },
    { icon: '🎨', text: 'ロゴ画像のアップロード（PDF差込にも反映）' },
    { icon: '🏦', text: '給与振込元銀行口座（最大 3 つ）' },
    { icon: '📜', text: 'PDF テンプレートのフォントサイズ・配置' },
    { icon: '🔒', text: '本設定は admin のみ編集可' },
  ]);
}

/* ---- 4. 事業所の追加・編集 ---- */
{
  const s = newSlide('🏢 事業所の追加・編集');
  addScreenshotWithPoints(s, [
    { icon: '➕', text: '事業所の新規追加（名前・住所）' },
    { icon: '✏️', text: '既存事業所の編集' },
    { icon: '🔄', text: 'DnD で表示順を変更' },
    { icon: '🗑', text: '削除は慎重に（履歴データも消える）' },
    { icon: '💡', text: '事業所追加時はマネージャー任命も忘れずに' },
  ]);
}

/* ---- 5. 事業所のフィーチャー ---- */
{
  const s = newSlide('🎚 事業所のフィーチャー設定');
  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 12.1, h: 4.9,
    fill: { color: COLOR.bg }, line: { color: COLOR.primary, width: 2 }, rectRadius: 0.15,
  });
  s.addText('事業所ごとに ON / OFF できる機能', {
    x: 0.6, y: 2.0, w: 12.1, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.primaryDark,
  });
  const items = [
    { icon: '🚐', label: 'transport_enabled', jp: '送迎機能', desc: 'OFF にすると送迎表ナビ + 送迎関連 UI が消える' },
    { icon: '📋', label: 'shift_only_mode', jp: 'シフトのみモード', desc: 'ON にすると利用表・送迎表・日次出力等が消える（本部用）' },
    { icon: '📅', label: 'shift_enabled', jp: 'シフト機能', desc: '基本 ON 運用。事業所セレクタからの除外用' },
  ];
  items.forEach((it, i) => {
    s.addText(it.icon, {
      x: 1.0, y: 2.85 + i * 1.2, w: 0.7, h: 1.0,
      fontSize: 32, align: 'center', color: COLOR.primary,
    });
    s.addText(it.jp + '（' + it.label + '）', {
      x: 1.8, y: 2.85 + i * 1.2, w: 10.5, h: 0.5,
      fontSize: 17, bold: true, fontFace: FONT_HEAD, color: COLOR.ink,
    });
    s.addText(it.desc, {
      x: 1.8, y: 3.35 + i * 1.2, w: 10.5, h: 0.7,
      fontSize: 14, fontFace: FONT_BODY, color: COLOR.inkLight,
    });
  });
}

/* ---- 6. 職員の招待 ---- */
{
  const s = newSlide('👤 職員の招待');
  addScreenshotWithPoints(s, [
    { icon: '✉️', text: 'メールアドレス + 氏名 + 役職を入力' },
    { icon: '🔗', text: '招待リンクが自動生成（有効期限 約 1 時間）' },
    { icon: '📩', text: 'リンクを LINE 等で本人に送る' },
    { icon: '🔑', text: '本人がリンクからパスワード設定 → ログイン' },
    { icon: '⚠️', text: '期限切れたら再招待（過去のリンクは無効）' },
  ]);
}

/* ---- 7. 職員の退職処理 ---- */
{
  const s = newSlide('🚪 職員の退職処理');
  addScreenshotWithPoints(s, [
    { icon: '🔘', text: '個別職員ページから「退職」ボタン' },
    { icon: '🚫', text: 'auth.users が BAN され、ログイン不可になる' },
    { icon: '🟡', text: '在職中のセッションも次回 middleware で signOut' },
    { icon: '💾', text: 'シフト・出勤履歴は残る（データ削除はしない）' },
    { icon: '🔄', text: '「在職に戻す」で復帰可（BAN 解除）' },
  ]);
  s.addText('💡 自分自身を退職にすることはできません', {
    x: 0.5, y: 6.7, w: 12.3, h: 0.4,
    fontSize: 14, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.accent,
  });
}

/* ---- 8. ロール変更 ---- */
{
  const s = newSlide('🔄 ロール変更');
  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 12.1, h: 4.9,
    fill: { color: COLOR.bg }, line: { color: COLOR.primary, width: 2 }, rectRadius: 0.15,
  });
  s.addText('3 ロール（+ 1 特殊ロール）', {
    x: 0.6, y: 2.0, w: 12.1, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.primaryDark,
  });
  const roles = [
    { label: 'admin',         jp: '管理者',      desc: '全権限。法人本部担当',                 c: COLOR.red },
    { label: 'manager',       jp: 'マネージャー', desc: '自事業所のシフト・送迎・人材を運用',    c: COLOR.primary },
    { label: 'shift_manager', jp: 'シフト統括',   desc: '事業所共用端末。閲覧・運用画面のみ',    c: COLOR.accent },
    { label: 'employee',      jp: '一般職員',    desc: '自分の画面・休み希望・コンテンツ閲覧', c: COLOR.green },
  ];
  roles.forEach((r, i) => {
    s.addShape('roundRect', {
      x: 1.0, y: 2.8 + i * 0.92, w: 11.3, h: 0.8,
      fill: { color: COLOR.white }, line: { color: r.c, width: 2 }, rectRadius: 0.1,
    });
    s.addText(r.jp, {
      x: 1.2, y: 2.8 + i * 0.92, w: 2.0, h: 0.8,
      fontSize: 18, bold: true, fontFace: FONT_HEAD, valign: 'middle', color: r.c,
    });
    s.addText(r.label, {
      x: 3.3, y: 2.8 + i * 0.92, w: 2.5, h: 0.8,
      fontSize: 14, fontFace: FONT_BODY, valign: 'middle', italic: true, color: COLOR.inkLight,
    });
    s.addText(r.desc, {
      x: 5.9, y: 2.8 + i * 0.92, w: 6.4, h: 0.8,
      fontSize: 14, fontFace: FONT_BODY, valign: 'middle', color: COLOR.ink,
    });
  });
}

/* ---- 9. シフト統括アカウントの発行 ---- */
{
  const s = newSlide('🪪 シフト統括アカウントの発行');
  addScreenshotWithPoints(s, [
    { icon: '🏢', text: '事業所ごとに 1 アカウント自動発行（API: issue-shift-account）' },
    { icon: '📧', text: 'email = shift-{8文字}@deaf-ic-nagoya.org（ダミー）' },
    { icon: '🔐', text: 'パスワードは 16 文字自動生成（モーダル 1 度だけ表示）' },
    { icon: '📋', text: '事業所の共用タブレット・PC に設定する想定' },
    { icon: '🔁', text: '紛失時は再発行可能（既存があると 409 エラー）' },
  ]);
}

/* ---- 10. アクセス権限マトリクス ---- */
{
  const s = newSlide('🔐 アクセス権限マトリクス');
  addScreenshotWithPoints(s, [
    { icon: '📊', text: 'manager × 事業所 のクロス表でアクセス権を可視化' },
    { icon: '➕', text: 'manager_facilities テーブルで兼任を許可' },
    { icon: '🎯', text: '兼任先で他事業所の運用画面を編集可能に' },
    { icon: '👁️', text: 'admin は全事業所を自動的に管轄' },
    { icon: '⚙️', text: '変更後は対象 manager の再ログイン推奨' },
  ]);
}

/* ---- 11. カテゴリ管理 ---- */
{
  const s = newSlide('🏷 カテゴリ管理（admin の責任）');
  addScreenshotWithPoints(s, [
    { icon: '📁', text: 'お知らせ / 研修 / マニュアル / 遵守事項 各 4 種' },
    { icon: '🎨', text: 'アイコン（絵文字）+ 色を統一して見やすく' },
    { icon: '🔄', text: 'DnD で並び替え（職員側にも反映）' },
    { icon: '🗑', text: '削除前に「このカテゴリの項目数」を確認' },
    { icon: '🎯', text: 'カテゴリ整理は admin の役割。manager 任せにしない' },
  ]);
}

/* ---- 12. コンテンツの一括公開・配信対象 ---- */
{
  const s = newSlide('📢 コンテンツの一括公開・配信対象');
  addScreenshotWithPoints(s, [
    { icon: '✅', text: '一括公開ボタンで全件 ON / OFF' },
    { icon: '🎯', text: '配信対象（target_type）: 全員 / 事業所 / 役職 で絞れる' },
    { icon: '🏢', text: '事業所別配信は target_facility_ids で複数選択可' },
    { icon: '👔', text: '役職別配信は target_position_ids で指定' },
    { icon: '🔔', text: '公開時に通知キューが自動生成（通知される）' },
  ]);
}

/* ---- 13. AI 診断 ---- */
{
  const s = newSlide('🤖 AI 診断（admin / manager のみ）');
  addScreenshotWithPoints(s, [
    { icon: '🧠', text: 'claude-haiku-4-5 で職員プロフィールを分析' },
    { icon: '📊', text: '月 30 回上限（MAX_AI_DIAGNOSIS_PER_MONTH）' },
    { icon: '👀', text: '結果は admin / manager のみ閲覧可（employee 非表示）' },
    { icon: '💼', text: '面談・育成計画のたたき台として活用' },
    { icon: '🚫', text: 'API キー未設定時は機能非表示（エラーにしない）' },
  ]);
}

/* ====================================================
 * 第 6 章 人事評価への活用（パープル背景でセクション分け）
 * ==================================================== */
addSectionDivider('Chapter 6', '人事評価への活用', COLOR.hr);

/* ---- 14. 評価エビデンス一覧 ---- */
{
  const s = newSlide('📊 自動的に蓄積される評価エビデンス', COLOR.hr);

  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 12.1, h: 4.9,
    fill: { color: COLOR.hrLight }, line: { color: COLOR.hr, width: 2 }, rectRadius: 0.15,
  });
  s.addText('日々の業務記録 = 評価の客観データ', {
    x: 0.6, y: 1.95, w: 12.1, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.hr,
  });
  const cats = [
    { icon: '⏰', cat: '勤務態度',    items: '出勤履歴 / 遅刻早退 / 公休・有給取得 / シフト変更申請の頻度' },
    { icon: '📚', cat: '学習姿勢',    items: '研修受講・合否 / 遵守事項同意 / カテゴリ別到達率' },
    { icon: '👁', cat: '情報感度',    items: 'お知らせ既読率 / マニュアル既読率 / 確認頻度' },
    { icon: '👥', cat: 'コミュニケーション', items: '部下管理画面のフィードバック / DM のやり取り' },
    { icon: '🤖', cat: 'AI 診断',     items: '月次 AI 診断の結果（参考材料として）' },
  ];
  cats.forEach((c, i) => {
    s.addText(c.icon, {
      x: 1.0, y: 2.65 + i * 0.78, w: 0.7, h: 0.7,
      fontSize: 26, align: 'center', color: COLOR.hr,
    });
    s.addText(c.cat, {
      x: 1.8, y: 2.65 + i * 0.78, w: 2.4, h: 0.7,
      fontSize: 16, bold: true, fontFace: FONT_HEAD, valign: 'middle', color: COLOR.hr,
    });
    s.addText(c.items, {
      x: 4.3, y: 2.65 + i * 0.78, w: 8.2, h: 0.7,
      fontSize: 13, fontFace: FONT_BODY, valign: 'middle', color: COLOR.ink,
    });
  });
}

/* ---- 15. 勤務態度 ---- */
{
  const s = newSlide('⏰ 勤務態度の評価', COLOR.hr);
  addScreenshotWithPoints(s, [
    { icon: '📅', text: '出勤日数 / 公休 / 有給 / 振休のバランス' },
    { icon: '🟡', text: '遅刻 (late) / 早退 (early_leave) ステータスの頻度' },
    { icon: '🔄', text: 'シフト変更申請の頻度・理由' },
    { icon: '🚐', text: '送迎担当の引き受け回数（協調性の指標）' },
    { icon: '👥', text: '同席日数で「特定児童との関係構築」を可視化' },
  ], '📸 部下管理 / 同席日数の画面');
}

/* ---- 16. 学習姿勢 ---- */
{
  const s = newSlide('📚 学習姿勢の評価', COLOR.hr);
  addScreenshotWithPoints(s, [
    { icon: '🎓', text: '研修の受講率（公開された研修のうち何件提出したか）' },
    { icon: '✅', text: '合否判定（passed / failed / resubmit）' },
    { icon: '📜', text: '遵守事項の同意までの日数（早い = 意識高い）' },
    { icon: '🔁', text: '差し戻し後の再提出の質' },
    { icon: '🏷', text: 'カテゴリ別の達成度（ろう者支援 / 児童発達 / 安全衛生 等）' },
  ], '📸 部下管理 / 進捗ダッシュボード');
}

/* ---- 17. 情報感度 ---- */
{
  const s = newSlide('👁 情報感度の評価', COLOR.hr);
  addScreenshotWithPoints(s, [
    { icon: '📢', text: 'お知らせの既読率・既読までの時間' },
    { icon: '📖', text: '業務マニュアルの閲覧頻度' },
    { icon: '🔔', text: '🆕 バッジへの反応速度' },
    { icon: '📊', text: 'view_logs に「いつ・何回」見たかが記録される' },
    { icon: '🎯', text: '配信対象に含まれているのに未読 = 要フォロー' },
  ], '📸 view_logs / 既読率レポート');
}

/* ---- 18. コミュニケーション ---- */
{
  const s = newSlide('💬 コミュニケーション・1on1', COLOR.hr);
  addScreenshotWithPoints(s, [
    { icon: '👤', text: '部下管理画面で個別プロファイルを参照' },
    { icon: '💬', text: 'DM 機能で 1on1 の記録を残す' },
    { icon: '📝', text: '面談メモは AI 診断と組み合わせて整理' },
    { icon: '📅', text: '定期 1on1 のリズムをアプリで可視化' },
    { icon: '🎯', text: '評価面談で「具体的な行動」を引用しやすい' },
  ], '📸 部下プロフィール / DM 画面');
}

/* ---- 19. 注意点（プライバシー・本人開示） ---- */
{
  const s = newSlide('⚠️ 注意点（プライバシー・本人開示）', COLOR.hr);

  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 12.1, h: 4.9,
    fill: { color: 'FCE8E6' }, line: { color: COLOR.red, width: 2 }, rectRadius: 0.15,
  });
  s.addText('運用前に必ず確認する 5 つ', {
    x: 0.6, y: 1.95, w: 12.1, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.red,
  });
  const cautions = [
    { icon: '📜', text: 'プライバシーポリシー: 業務記録を評価に使うことを明記' },
    { icon: '👁', text: '本人開示の方針: 求められたら開示するのか、しないのか' },
    { icon: '⚖️', text: '労務リスク: 「監視ツール」と受け取られない説明をする' },
    { icon: '🤖', text: 'AI 診断結果は「参考資料」止め。最終判断は人がする' },
    { icon: '🤝', text: '人事制度との整合: 既存の評価フォーマットに合わせて使う' },
  ];
  cautions.forEach((c, i) => {
    s.addText(c.icon, {
      x: 1.0, y: 2.65 + i * 0.78, w: 0.7, h: 0.7,
      fontSize: 24, align: 'center', color: COLOR.red,
    });
    s.addText(c.text, {
      x: 1.8, y: 2.65 + i * 0.78, w: 10.7, h: 0.7,
      fontSize: 15, fontFace: FONT_BODY, valign: 'middle', color: COLOR.ink,
    });
  });
}

/* ---- 20. 困ったら ---- */
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
    fill: { color: COLOR.white }, line: { type: 'none' }, rectRadius: 0.2,
  });
  s.addText([
    { text: '🛠 開発担当へ連絡\n', options: { fontSize: 22, bold: true, color: COLOR.primaryDark, fontFace: FONT_HEAD } },
    { text: '\n', options: { fontSize: 8 } },
    { text: 'GitHub Issue / メール — 仕様変更の相談も歓迎', options: { fontSize: 16, color: COLOR.inkLight, fontFace: FONT_BODY } },
  ], {
    x: 3.0, y: 4.2, w: 7.3, h: 2.0, align: 'center', valign: 'middle',
  });
  s.addText(`${TOTAL} / ${TOTAL}`, {
    x: 0, y: 7.0, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });
}

const out = './docs/manuals/admin_guide.pptx';
pres.writeFile({ fileName: out }).then(() => {
  console.log('OK: ' + out);
});
