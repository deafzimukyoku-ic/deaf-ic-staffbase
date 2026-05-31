# シフト公開通知の真因修正 + 公開時の職員通知 + 既定月の改善

- **対象**: deaf-ic / diletto-new-staffbase（同一コード・同一変更）
- **着手日**: 2026-05-31
- **起点**: パレット事業所「6月のシフトを公開したが職員が見れない」報告
- **種別**: バグ修正（②）＋ 通知設計変更（③）＋ UX 既定値変更（①）

---

## 1. 背景・調査結果

報告の主訴「職員が公開済みシフトを見れない」は **RLS の問題ではない**。
- 本番 DB で実 employee（パレット所属）の JWT claims を注入して再現テストした結果、
  `shift_assignments` の 6月 published 318 件すべてが RLS 通過で SELECT 可能だった。
- `get_my_role()`=employee / `get_my_facility_ids()`=[パレット] / tenant 一致、すべて正常。

実際には次の 2 つの別問題が重なっていた。

### 問題② 真因: シフト通知が一切 enqueue されない（メール・PWA 両方）
- migration 180 で `notification_queue.first_scheduled_at` を **NOT NULL** 化。
- enqueue 経路は 2 つ:
  - `app/api/notifications/enqueue/route.ts`（コンテンツ系）→ `first_scheduled_at` を設定（OK）
  - `app/api/shifts/transition/route.ts`（シフト系）→ **設定漏れ（NG）**
- 後者の INSERT が NOT NULL 違反で必ず失敗。さらに `catch` がログのみで握り潰し、
  publish_status 遷移自体は成功するため **「公開できるのに通知ゼロ」** が
  180 適用（2026-05-18）以降ずっと継続。
- 証跡: `notification_queue` の shift_ready/shift_publish が累計 0 件
  （deaf-ic 108 件中 0 / diletto 33 件中 0）。dry-run INSERT で同エラーを再現。

### 問題① 「未公開」誤表示: 職員向け画面が「今月」固定
- シフトは通常「翌月分」を先に公開するが、職員向けの 2 画面が常に **今月** を見ていた。
  - 施設シフトタブ `MyFacilityShiftView`: 初期表示月 = 今月（draft）→「まだ公開されていません」
  - ダッシュボード シフトカード: 今月のみ集計 → 公開分 0 →「未公開」表示
- 問題②で通知（職員を当月へ深リンク）も飛ばないため、職員が公開済み月に辿り着けなかった。

---

## 2. 変更内容

### ② enqueue バグ修正（最優先）
| ファイル | 変更 |
|---|---|
| `app/api/shifts/transition/route.ts` | enqueue INSERT に `first_scheduled_at` を設定。`catch` の握り潰しをやめ `notification_warning` をレスポンスに含める |
| `components/shift/ShiftFull.tsx` | `transitionTo` が `notification_warning` を受けたら alert 表示（無症状化の防止） |
| migration 215（deaf-ic）/ 200（diletto） | `notification_queue.first_scheduled_at` に `DEFAULT now()`（構造的な再発防止ガード） |

### ③ 公開時に職員へも通知（設計変更）
| ファイル | 変更 |
|---|---|
| `lib/email/shift-notification-email.ts` | `buildShiftPublishedEmployeeEmail` 新規。職員向け「公開されました」+ `/my/requests?tab=facility-shift&month=` 深リンク。骨格・配色は兄弟テンプレ（teal）に揃える |
| `app/api/cron/send-notifications/route.ts` | `processShiftRow` を配信グループ方式に。`shift_publish` で admin（/admin/shifts）に加え該当施設 active employee へ別テンプレ + Push を配信 |

- 従来: 公開時 = admin のみ通知 / 職員は一段前の ready（作成完了）時に通知。
- 変更後: 公開時に職員へも「公開されました」通知（メール + PWA Push）。

### ① 既定月を「公開済み最新月」に
| ファイル | 変更 |
|---|---|
| `components/employee/MyFacilityShiftView.tsx` | URL 明示 > 公開済み最新月（smartDefault: 窓内 prev/this/next を調べ翌月>今月>前月の優先で採用）> 今月。`MonthStepper` に `defaultMonth={monthStr}` を連動 |
| `app/(employee)/my/dashboard/page.tsx` | シフトカードを今月+来月で集計し、今月に公開/ready の出勤予定が無ければ来月を表示・深リンク |

---

## 3. ロール差分
- **employee**: 公開時にメール + Push 受信（新規）。施設シフトタブ / ダッシュボードが公開済み月を初期表示。
- **admin**: 従来通り公開時に「公開しました」メール + Push（/admin/shifts）。
- **manager / shift_manager**: 遷移操作時に enqueue 失敗があれば alert で気付ける（従来は無言）。

## 4. 既知の制約・非対象
- 公開時の職員通知は **主所属が当該 facility の職員** が対象（shift_ready と同じ。兼任先のみの職員は未対象）。
- PWA Push は端末側で購読登録済みの職員のみ届く（現状購読数が少ないため、当面はメールが主経路）。
- 既存シフト email テンプレ群（teal #0f766e）は `docs/mail-design-rules.md` の canonical 骨格（#4169e1 + logo/footer）から **以前から乖離**している。本変更は兄弟テンプレとの一貫性を優先し teal に揃えた。canonical への統一は別タスク（要ユーザー判断）。

## 5. 検証
- 両 repo で `tsc --noEmit` パス。
- migration apply script の before/after dry-run で
  「`first_scheduled_at` 省略 INSERT が BEFORE=NOT NULL 違反で失敗 → AFTER=成功」を実証。
- デプロイ後の手動確認（推奨）: テスト施設でシフトを ready→published し、
  ①職員にメール/Push が届く ②施設シフトタブ/ダッシュボードが公開月を表示 を確認。
