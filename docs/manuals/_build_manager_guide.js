/**
 * manager_guide.pptx — マネージャー（manager）向け 操作ガイド
 *
 * 設計:
 *   - 自事業所のシフト・送迎・職員・児童・お知らせを運用するマネージャー向け
 *   - 28 枚構成。1 画面 1 枚で「この画面で何ができる」を眺めて分かるレベル
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
pres.title = 'マネージャー操作ガイド';
pres.author = '認定NPO法人 名古屋ろう国際センター';
pres.company = 'deaf-ic';

const W = 13.333;
const TOTAL = 28;

function addTitleSlide(s) {
  s.background = { color: COLOR.primary };
  s.addText('🧭', {
    x: 0, y: 1.0, w: W, h: 1.5,
    fontSize: 110, align: 'center', color: COLOR.white,
  });
  s.addText('マネージャー操作ガイド', {
    x: 0, y: 2.7, w: W, h: 1.2,
    fontSize: 54, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.white,
  });
  s.addText('〜 自事業所のシフト・送迎・人材を運用する 〜', {
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

function addHeader(s, title, page) {
  s.addShape('rect', {
    x: 0, y: 0, w: W, h: 0.55,
    fill: { color: COLOR.primary }, line: { type: 'none' },
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
function newSlide(title) {
  pageNo++;
  const s = pres.addSlide();
  addHeader(s, title, pageNo);
  return s;
}

/* ---- 1. 表紙 ---- */
addTitleSlide(pres.addSlide());
pageNo = 1;

/* ---- 2. マネージャーの役割 ---- */
{
  const s = newSlide('🧭 マネージャーの役割');
  // 左: できる
  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 6.0, h: 4.9,
    fill: { color: 'E6F4F1' },
    line: { color: COLOR.green, width: 2 }, rectRadius: 0.15,
  });
  s.addText('✅ できること', {
    x: 0.6, y: 1.95, w: 6.0, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.green,
  });
  s.addText([
    { text: '• 自事業所の全シフト・送迎・利用予定の編集\n', options: { fontSize: 16, paraSpaceAfter: 6 } },
    { text: '• 児童管理（自事業所のみ）\n', options: { fontSize: 16, paraSpaceAfter: 6 } },
    { text: '• 職員のシフト関連設定（時間・資格・並び順）\n', options: { fontSize: 16, paraSpaceAfter: 6 } },
    { text: '• 休み希望の承認 / 変更申請の承認\n', options: { fontSize: 16, paraSpaceAfter: 6 } },
    { text: '• 利用料金表の作成・印刷\n', options: { fontSize: 16, paraSpaceAfter: 6 } },
    { text: '• お知らせ / 研修 / マニュアル / 遵守事項の編集\n', options: { fontSize: 16, paraSpaceAfter: 6 } },
    { text: '• カテゴリ管理（自事業所スコープ）', options: { fontSize: 16 } },
  ], {
    x: 0.9, y: 2.6, w: 5.5, h: 4.0, fontFace: FONT_BODY, color: COLOR.ink,
  });

  // 右: できない
  s.addShape('roundRect', {
    x: 6.8, y: 1.85, w: 6.0, h: 4.9,
    fill: { color: 'FCE8E6' },
    line: { color: COLOR.red, width: 2 }, rectRadius: 0.15,
  });
  s.addText('⛔ できないこと（管理者へ）', {
    x: 6.8, y: 1.95, w: 6.0, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.red,
  });
  s.addText([
    { text: '• 職員の追加（招待）・退職処理\n', options: { fontSize: 16, paraSpaceAfter: 8 } },
    { text: '• ロール変更（admin / manager / employee）\n', options: { fontSize: 16, paraSpaceAfter: 8 } },
    { text: '• 事業所の追加・削除\n', options: { fontSize: 16, paraSpaceAfter: 8 } },
    { text: '• 法人（tenant）設定\n', options: { fontSize: 16, paraSpaceAfter: 8 } },
    { text: '• 他事業所の運用画面の編集', options: { fontSize: 16 } },
  ], {
    x: 7.1, y: 2.6, w: 5.5, h: 4.0, fontFace: FONT_BODY, color: COLOR.ink,
  });
}

/* ---- 3. ダッシュボード ---- */
{
  const s = newSlide('🏠 マネージャーダッシュボード');
  addScreenshotWithPoints(s, [
    { icon: '📊', text: '今月の進捗（シフト公開状況・休み希望の集まり具合）' },
    { icon: '📨', text: '部下からの新着申請・承認待ち件数' },
    { icon: '🔔', text: '未対応の通知（差戻された研修・コメント）' },
    { icon: '🚐', text: '今日の送迎担当の状況' },
    { icon: '🔗', text: '主要画面へのショートカット' },
  ]);
}

/* ---- 4. 利用予定（手動入力） ---- */
{
  const s = newSlide('📅 利用予定（手動入力）');
  addScreenshotWithPoints(s, [
    { icon: '👶', text: '児童ごとに 1 行・日付ごとに 1 列のグリッド' },
    { icon: '🖱️', text: 'セルをクリックして利用予定モーダルを開く' },
    { icon: '🕐', text: '迎え時刻・送り時刻・送迎方法（迎/自）を設定' },
    { icon: '🟥', text: 'お休み / 欠席 / キャンセル待ち を選ぶと時刻 NULL' },
    { icon: '💾', text: '保存すると即時グリッドに反映' },
  ]);
}

/* ---- 5. 利用予定（PDF 取込） ---- */
{
  const s = newSlide('📄 利用予定（デイロボ PDF 取込）');
  addScreenshotWithPoints(s, [
    { icon: '📥', text: '「PDF を取り込む」からデイロボ PDF を選択' },
    { icon: '🤖', text: 'AI が自動解析（claude-sonnet-4 を使用）' },
    { icon: '✅', text: '確認画面で内容を必ずチェック' },
    { icon: '🔁', text: '同じ日付の予定があれば上書き（追記ではない）' },
    { icon: '🚫', text: 'API キー未設定時は手動入力にフォールバック' },
  ]);
  s.addText('💡 旧データは新 PDF に含まれない児童だけ残るので注意', {
    x: 0.5, y: 6.7, w: 12.3, h: 0.4,
    fontSize: 13, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.accent,
  });
}

/* ---- 6. 出席ステータス ---- */
{
  const s = newSlide('🎯 出席ステータスの考え方');
  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 12.1, h: 4.9,
    fill: { color: COLOR.bg }, line: { color: COLOR.primary, width: 2 }, rectRadius: 0.15,
  });
  s.addText('出席判定 = 「時刻が入っている」AND「キャンセル待ちではない」', {
    x: 0.6, y: 2.0, w: 12.1, h: 0.6,
    fontSize: 20, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.primaryDark,
  });
  const states = [
    { label: '🟢 出席（planned/present）', desc: '時刻入り → 自動で出席カウント。利用料金表・送迎表・シフト人数に反映' },
    { label: '🟥 お休み（leave）', desc: '時刻 NULL に強制。利用料金表・送迎表から除外' },
    { label: '⛔ 欠席（absent）', desc: '時刻 NULL に強制。利用料金表・送迎表から除外' },
    { label: '⏳ キャンセル待ち（waitlist）', desc: '時刻保持（present 昇格時のため）。出席にはカウントしない' },
  ];
  states.forEach((st, i) => {
    s.addText(st.label, {
      x: 0.9, y: 2.9 + i * 0.95, w: 4.2, h: 0.6,
      fontSize: 16, bold: true, fontFace: FONT_HEAD, valign: 'middle', color: COLOR.ink,
    });
    s.addText(st.desc, {
      x: 5.2, y: 2.9 + i * 0.95, w: 7.5, h: 0.6,
      fontSize: 14, fontFace: FONT_BODY, valign: 'middle', color: COLOR.inkLight,
    });
  });
}

/* ---- 7. シフト作成（自動生成） ---- */
{
  const s = newSlide('🤖 シフト作成（半自動生成）');
  addScreenshotWithPoints(s, [
    { icon: '📅', text: '月を選んで「シフト生成」ボタン' },
    { icon: '📊', text: '日ごとの利用人数から最低出勤人数を計算' },
    { icon: '🎓', text: '有資格者の最低人数も確保' },
    { icon: '🏖', text: '職員の休み希望（公休・有給）を反映' },
    { icon: '📝', text: '生成結果は「下書き」状態で保存（自動公開しない）' },
  ]);
}

/* ---- 8. シフト作成（手動調整） ---- */
{
  const s = newSlide('✋ シフト作成（手動調整）');
  addScreenshotWithPoints(s, [
    { icon: '🖱️', text: '日付セルをクリックして職員を追加・削除' },
    { icon: '🕐', text: '出勤時刻・退勤時刻を直接編集' },
    { icon: '🏷', text: 'コアタイム（提供時間内）の有資格者数を表示' },
    { icon: '🔢', text: '余力（児童数 ÷ 出勤数）が緑/黄/赤で警告' },
    { icon: '💾', text: '変更は自動保存（手動セーブ不要）' },
  ]);
}

/* ---- 9. シフト公開フロー ---- */
{
  const s = newSlide('🚦 シフト公開フロー');
  // 3 段階フロー
  const stages = [
    { color: COLOR.inkLight, bg: 'F3F4F6', label: 'draft', jp: '下書き', desc: '編集中。職員には見えない' },
    { color: COLOR.accent,   bg: 'FFF4E5', label: 'ready', jp: '作成完了', desc: '社内レビュー用。マネージャー / 管理者のみ' },
    { color: COLOR.green,    bg: 'E8F5E9', label: 'published', jp: '公開', desc: '職員が自分のシフトを閲覧可能' },
  ];
  stages.forEach((st, i) => {
    const x = 0.6 + i * 4.15;
    s.addShape('roundRect', {
      x, y: 2.0, w: 4.0, h: 4.4,
      fill: { color: st.bg }, line: { color: st.color, width: 2 }, rectRadius: 0.15,
    });
    s.addText(st.jp, {
      x, y: 2.3, w: 4.0, h: 0.7,
      fontSize: 26, bold: true, fontFace: FONT_HEAD,
      align: 'center', color: st.color,
    });
    s.addText(st.label, {
      x, y: 3.0, w: 4.0, h: 0.5,
      fontSize: 14, fontFace: FONT_BODY,
      align: 'center', color: st.color, italic: true,
    });
    s.addText(st.desc, {
      x: x + 0.3, y: 3.7, w: 3.4, h: 2.5,
      fontSize: 14, fontFace: FONT_BODY,
      align: 'center', color: COLOR.ink,
    });
  });
  // 矢印
  for (let i = 0; i < 2; i++) {
    s.addText('▶', {
      x: 4.55 + i * 4.15, y: 3.8, w: 0.4, h: 0.6,
      fontSize: 28, align: 'center', color: COLOR.primary, bold: true,
    });
  }
  s.addText('💡 「作成完了」を押すと差し戻し不可（公開前提）。慎重に', {
    x: 0.5, y: 6.7, w: 12.3, h: 0.4,
    fontSize: 14, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.accent,
  });
}

/* ---- 10. シフトの再公開 ---- */
{
  const s = newSlide('🔄 シフトの再公開（差し替え）');
  addScreenshotWithPoints(s, [
    { icon: '⚠️', text: '公開後の編集は「差分警告」が出る' },
    { icon: '🔁', text: '「再公開」を押すと変更が職員に反映' },
    { icon: '📨', text: '通知が職員側に届く（誰がいつ変更したか記録）' },
    { icon: '🛑', text: '「is_confirmed=true」のレコードは自動上書きしない' },
    { icon: '📜', text: '変更履歴は監査ログに残る' },
  ]);
}

/* ---- 11. 送迎担当（自動割当） ---- */
{
  const s = newSlide('🚐 送迎担当（自動割当）');
  addScreenshotWithPoints(s, [
    { icon: '🤖', text: '「送迎を生成」ボタンで自動割当' },
    { icon: '👥', text: '優先順: 出勤者 → 勤務時間内 → エリア一致 → 同便' },
    { icon: '🔢', text: '1 送迎につき最大 2 名' },
    { icon: '🟥', text: '条件未達は「未割当」赤枠で警告（空欄にしない）' },
    { icon: '⚖️', text: 'トリップ数を職員間で均等分散' },
  ]);
}

/* ---- 12. 送迎担当（手動修正） ---- */
{
  const s = newSlide('✋ 送迎担当（手動修正）');
  addScreenshotWithPoints(s, [
    { icon: '🖱️', text: '送迎セルをクリックして担当者を追加・削除' },
    { icon: '⏰', text: '送迎時刻も同時に調整可能' },
    { icon: '🚫', text: '勤務時間外の職員は警告マーク' },
    { icon: '⏳', text: 'キャンセル待ちは「集約バー」で別表示' },
    { icon: '🖨', text: '印刷ボタンで A4 横で出力' },
  ]);
}

/* ---- 13. 利用料金表（月選択） ---- */
{
  const s = newSlide('💰 利用料金表（月選択・自動計算）');
  addScreenshotWithPoints(s, [
    { icon: '📅', text: '月を選択すると児童一覧が表示' },
    { icon: '🔢', text: '出席日数を自動カウント（出席判定通り）' },
    { icon: '🍪', text: 'おやつ消耗品代 = 出席日数 × ¥50（自動）' },
    { icon: '✏️', text: '公文代は児童設定の月額（固定）' },
    { icon: '🎉', text: '当月のイベントが列として表示（参加チェック）' },
  ]);
}

/* ---- 14. 利用料金表（オーバーライド・印刷） ---- */
{
  const s = newSlide('💴 利用料金表（オーバーライド・印刷）');
  addScreenshotWithPoints(s, [
    { icon: '📝', text: '利用負担額の初期値を手動で上書き可' },
    { icon: '☑️', text: 'イベント参加は児童ごとにチェック' },
    { icon: '💾', text: '保存すると billing_summaries に永続化' },
    { icon: '🖨', text: '印刷で A4 横にフィット（受取日列を除外）' },
    { icon: '🔁', text: '再印刷時は同じ数字（snapshot 保存）' },
  ]);
}

/* ---- 15. 業務日報 ---- */
{
  const s = newSlide('📝 業務日報');
  addScreenshotWithPoints(s, [
    { icon: '📅', text: '日付範囲を選んで複数日連続印刷' },
    { icon: '👶', text: '当日の利用者一覧（出欠席・備考）' },
    { icon: '👷', text: '当日の出勤職員一覧（時刻）' },
    { icon: '📋', text: '活動内容欄（事業所設定の定型文を印字）' },
    { icon: '🖨', text: '1 日 1 ページ A4 縦で印刷' },
  ]);
}

/* ---- 16. 日次出力 ---- */
{
  const s = newSlide('📤 日次出力');
  addScreenshotWithPoints(s, [
    { icon: '👶', text: '当日の利用児童カード（DnD 並び替え可）' },
    { icon: '🚐', text: '送迎担当・到着時刻が一目で分かる' },
    { icon: '⏳', text: 'キャンセル待ちは別セクション' },
    { icon: '👷', text: '出勤職員の人数・有資格者数を表示' },
    { icon: '🖨', text: '印刷で当日のサマリ A4 出力' },
  ]);
}

/* ---- 17. 週次送迎表 ---- */
{
  const s = newSlide('📅 週次送迎表');
  addScreenshotWithPoints(s, [
    { icon: '📆', text: '1 週間分の送迎担当を一覧表示' },
    { icon: '👤', text: '職員ごとの行 / 日付ごとの列' },
    { icon: '🚐', text: 'セルに送迎担当の児童名と時刻' },
    { icon: '🖨', text: 'A4 横で印刷可' },
    { icon: '👁️', text: '送迎が無効の事業所では表示されない' },
  ]);
}

/* ---- 18. 同席日数 ---- */
{
  const s = newSlide('👥 同席日数（職員 × 児童）');
  addScreenshotWithPoints(s, [
    { icon: '📊', text: '行: 児童 / 列: 職員 / セル: 同席日数' },
    { icon: '🎯', text: '時間帯重複で同席判定（max(start) < min(end)）' },
    { icon: '📅', text: '月単位で集計' },
    { icon: '🖨', text: 'A4 横で印刷' },
    { icon: '🔍', text: '担当の偏りを発見しやすい' },
  ]);
}

/* ---- 19. 休み希望（確認・承認） ---- */
{
  const s = newSlide('🏖 休み希望（確認・承認）');
  addScreenshotWithPoints(s, [
    { icon: '👀', text: '提出された全職員の希望を一覧表示' },
    { icon: '🔴', text: '公休 / 有給 / 出勤可能 を色分け' },
    { icon: '📊', text: '日ごとの希望者数集計（集中日が見える）' },
    { icon: '✏️', text: '直接編集可（職員に代わって追加・削除）' },
    { icon: '⏰', text: '締切前なら何度でも修正できる' },
  ]);
}

/* ---- 20. シフト変更申請 ---- */
{
  const s = newSlide('🔄 シフト変更申請');
  addScreenshotWithPoints(s, [
    { icon: '📨', text: '部下からの変更申請が一覧で届く' },
    { icon: '👀', text: '理由・希望日時を確認' },
    { icon: '✅', text: '「承認」を押すとシフトに反映' },
    { icon: '❌', text: '「却下」する場合はコメント必須' },
    { icon: '⚠️', text: '出勤中の管理者のみ承認可（不在時は admin へ）' },
  ]);
}

/* ---- 21. 部下管理 ---- */
{
  const s = newSlide('👤 部下管理');
  addScreenshotWithPoints(s, [
    { icon: '📋', text: '管轄事業所の職員一覧' },
    { icon: '🔍', text: '個別職員の詳細プロフィール（住所・連絡先除く）' },
    { icon: '📊', text: '研修・遵守事項・お知らせの既読率' },
    { icon: '📅', text: '出勤履歴・休暇取得履歴' },
    { icon: '💬', text: 'DM 機能で個別連絡可能' },
  ]);
}

/* ---- 22. 児童管理 ---- */
{
  const s = newSlide('👶 児童管理');
  addScreenshotWithPoints(s, [
    { icon: '📋', text: '自事業所の在籍児童一覧' },
    { icon: '➕', text: '新規児童の追加・編集' },
    { icon: '💰', text: '料金設定（市町村・上限額・公文月額）' },
    { icon: '🚐', text: '送迎情報（迎えエリア・送りエリア）' },
    { icon: '🔄', text: 'DnD で表示順を変更' },
  ]);
}

/* ---- 23. 職員管理 ---- */
{
  const s = newSlide('👷 職員管理（シフト用設定）');
  addScreenshotWithPoints(s, [
    { icon: '🕐', text: '基本勤務時間（default_start/end_time）' },
    { icon: '🎓', text: '資格・シフト用資格' },
    { icon: '🚐', text: '送迎可能エリア（迎え・送り）' },
    { icon: '🚗', text: 'ドライバー / 添乗員フラグ' },
    { icon: '🔄', text: 'DnD でシフト表の表示順を変更' },
  ]);
  s.addText('💡 職員の追加・退職・ロール変更は管理者の役割', {
    x: 0.5, y: 6.7, w: 12.3, h: 0.4,
    fontSize: 14, italic: true, fontFace: FONT_BODY,
    align: 'center', color: COLOR.accent,
  });
}

/* ---- 24. イベント設定 ---- */
{
  const s = newSlide('🎉 イベント設定');
  addScreenshotWithPoints(s, [
    { icon: '📅', text: '当月のイベント一覧（誕生日会・お花見等）' },
    { icon: '➕', text: '名前・日付・参加費を入力して追加' },
    { icon: '✏️', text: '事後修正・削除も可能' },
    { icon: '💰', text: '料金表に自動で列として登場' },
    { icon: '🔁', text: '月切替で過去のイベントも見られる' },
  ]);
}

/* ---- 25. 事業所設定 ---- */
{
  const s = newSlide('🏢 事業所設定');
  addScreenshotWithPoints(s, [
    { icon: '⏰', text: 'コアタイム（提供時間）の開始・終了' },
    { icon: '🎓', text: '有資格者の最低出勤人数' },
    { icon: '🏷', text: '送迎エリアラベル（迎え・送り）' },
    { icon: '🎨', text: '資格タイプの定義' },
    { icon: '📝', text: '業務日報のテンプレート文章' },
  ]);
}

/* ---- 26. カテゴリ管理 ---- */
{
  const s = newSlide('🏷 カテゴリ管理');
  addScreenshotWithPoints(s, [
    { icon: '📁', text: 'お知らせ / 研修 / マニュアル / 遵守事項 用に独立' },
    { icon: '🎨', text: 'アイコン（絵文字）+ 色を設定' },
    { icon: '🔄', text: 'DnD で表示順を変更' },
    { icon: '📥', text: '他の分類から取り込む機能あり' },
    { icon: '⚡', text: '追加・編集後すぐ親画面に反映（修正済）' },
  ]);
}

/* ---- 27. お知らせ・研修・マニュアル・遵守事項の作成 ---- */
{
  const s = newSlide('📢 コンテンツの作成・編集');
  s.addShape('roundRect', {
    x: 0.6, y: 1.85, w: 12.1, h: 4.9,
    fill: { color: COLOR.bg }, line: { color: COLOR.primary, width: 2 }, rectRadius: 0.15,
  });
  s.addText('共通の編集パターン', {
    x: 0.6, y: 2.0, w: 12.1, h: 0.5,
    fontSize: 22, bold: true, fontFace: FONT_HEAD,
    align: 'center', color: COLOR.primaryDark,
  });
  const items = [
    { icon: '📢', label: 'お知らせ',  desc: '配信対象（事業所 / 役職）を絞れる。既読記録あり' },
    { icon: '📚', label: '研修',      desc: '本文 + PDF + 動画。受講提出と合否判定' },
    { icon: '📖', label: '業務マニュアル', desc: 'PDF / 動画 / 本文。閲覧記録のみ（合否なし）' },
    { icon: '📜', label: '遵守事項',  desc: '同意チェック必須。更新時は再同意リセット' },
  ];
  items.forEach((it, i) => {
    s.addText(it.icon, {
      x: 1.0, y: 2.85 + i * 0.85, w: 0.7, h: 0.7,
      fontSize: 28, align: 'center', color: COLOR.primary,
    });
    s.addText(it.label, {
      x: 1.8, y: 2.85 + i * 0.85, w: 2.5, h: 0.7,
      fontSize: 18, bold: true, fontFace: FONT_HEAD, valign: 'middle', color: COLOR.ink,
    });
    s.addText(it.desc, {
      x: 4.4, y: 2.85 + i * 0.85, w: 8.0, h: 0.7,
      fontSize: 14, fontFace: FONT_BODY, valign: 'middle', color: COLOR.inkLight,
    });
  });
}

/* ---- 28. 困ったら ---- */
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
    { text: '🏢 管理者へ連絡\n', options: { fontSize: 22, bold: true, color: COLOR.primaryDark, fontFace: FONT_HEAD } },
    { text: '\n', options: { fontSize: 8 } },
    { text: 'LINE / 電話 / 直接 — どの手段でも OK', options: { fontSize: 16, color: COLOR.inkLight, fontFace: FONT_BODY } },
  ], {
    x: 3.0, y: 4.2, w: 7.3, h: 2.0, align: 'center', valign: 'middle',
  });
  s.addText(`${TOTAL} / ${TOTAL}`, {
    x: 0, y: 7.0, w: W, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY,
    align: 'center', color: COLOR.white,
  });
}

const out = './docs/manuals/manager_guide.pptx';
pres.writeFile({ fileName: out }).then(() => {
  console.log('OK: ' + out);
});
