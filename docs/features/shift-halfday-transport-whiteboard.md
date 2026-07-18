# shift-halfday-transport-whiteboard（半休を送迎表・ホワイトボードの出勤者に反映）

> **承認済み** — 2026-07-18 ユーザー承認（「これでokです！ ホワイトボードの半休表示も入れて欲しい」）。
> ホワイトボードは **勤務時間 + AM休/PM休 バッジ** で表示（時間だけでなくラベル併記）で確定。
> **起票**: 2026-07-18 / **発端**: シフト表に AM休/PM休＋勤務時間を出せるようにした（migration 218）が、
> 送迎表・ホワイトボード（日次出力）が追従しておらず、半休職員が出勤者として表示されない report。

## 1. 機能概要

### 機能名
`shift-halfday-transport-whiteboard`

### 目的
半休（`am_off`=午後勤務 / `pm_off`=午前勤務）の職員は `shift_assignments` に勤務時間区間を持って
保存される（[generateShift.ts:159-171](../../lib/logic/generateShift.ts#L159)。PM休=`[出勤,13:30]` / AM休=`[14:30,退勤]`）。
しかし送迎表・ホワイトボード・送迎自動割当は**出勤者を `assignment_type === 'normal'` だけで抽出**しているため、
半休職員が「その時間帯に実際に勤務しているのに存在しない」扱いになる。これを解消し、半休職員を
勤務時間つきで出勤者として表示し、送迎自動割当の候補にも（勤務時間内の便に限り）含める。

### スコープ（やる）
- **ホワイトボード（日次出力）**: 「本日の出勤」一覧に半休職員を表示（勤務時間 + AM休/PM休 バッジ）
- **送迎表（日次）**: 半休職員を送迎担当の候補（`availableStaffForDay`）に含める
- **送迎自動割当**: 半休職員を候補に含めるが、**便時刻が勤務区間に収まる便のみ**（ユーザー確定「勤務時間内の便のみ候補」）。
  この時間区間フィルタは既存ロジック（[generateTransport.ts:372-377](../../lib/logic/generateTransport.ts#L372)）が既に担うため、
  半休の勤務区間（午前 or 午後）で自動的に正しく絞られる
- **出勤系判定の一元化**: `assignment_type === 'normal'` の直書き 4 箇所を、出勤系（normal/am_off/pm_off）を
  判定する共通ヘルパーに置換（式の二重定義を避ける）

### スコープ（やらない）
| やらないこと | 理由 |
|---|---|
| DBスキーマ変更 / migration | `am_off`/`pm_off` は migration 218 で既に存在。**列も CHECK も追加不要** |
| fetch の select 変更 | 対象ビューは既に `shift_assignments` を `.select('*')` で取得済み（assignment_type / start_time / end_time / segment_order 取得済み） |
| **週次送迎表**（WeeklyTransportFull） | shift_assignments を参照せず職員の `default_start/end_time` で動く別設計（[WeeklyTransportFull.tsx:168](../../components/shift/WeeklyTransportFull.tsx#L168)）。当日半休の概念を持たない。今回対象外 |
| 半休の勤務時間境界の変更 | 13:30 / 14:30 の境界は shift-halfday-availability-reflection.md 決定事項#1 のまま |
| 送迎の退勤ガード（transport_min_end_time）の仕様変更 | 既存挙動を維持。半休の午前勤務者が退勤 13:30 で午後の送り便に出られないのは「勤務時間内の便のみ候補」と整合的（意図どおり） |

---

## 2. 影響範囲

`docs/constraints.md` 確認済み。**§1（Vercel Function 経由の大容量配信）/ §2（Supabase pooler）いずれにも非該当**。
本件はクライアント内フィルタ拡張 + 生成ロジックのフィルタ拡張のみで、新規 cron / 重処理 / 外部 API / 大容量転送 /
DBスキーマ変更 は一切ない。

| 種別 | 対象 | 変更内容 |
|---|---|---|
| ヘルパー新設 | `lib/logic/shiftAssignment.ts`（新規 or 既存の適所） | `isWorkingAssignmentType(t)` / `isWorkingShift(sa)`（出勤系 = normal/am_off/pm_off、かつ時間あり）。4 箇所の直書き判定を集約 |
| 送迎割当ロジック | `lib/logic/generateTransport.ts` | `:114` workingStaff 抽出 / `:360` selectStaff 候補 の `assignment_type === 'normal'` を出勤系判定に置換。時間区間フィルタ（`:372-377`）は不変（半休区間で自動的に効く） |
| ホワイトボード | `components/shift/DailyOutputFull.tsx` | `:435` onDuty 抽出を出勤系に拡張 / `OnDutyStaff` 型に区分追加 / `:809-827` 表示に AM休/PM休 バッジ追加 / `:63` コメント更新 |
| 送迎表（日次） | `components/shift/TransportFull.tsx` | `:616` availableStaffForDay 抽出を出勤系に拡張 / 追加モーダルの leave 判定（`:1466-1476`）で am_off/pm_off の扱いを明確化 |
| ドキュメント | `docs/reference-map.md` | generateTransport / DailyOutputFull / TransportFull エントリに半休対応を追記。新ヘルパー登録 |
| ドキュメント | `docs/progress.html` | 本機能の行を追加（CLAUDE.md §3） |
| ドキュメント | `docs/features/shift-halfday-availability-reflection.md` | 「実装メモ」に本機能で下流ビューを追従させた旨を追記（相互リンク） |

### 変更しないファイル（誤爆防止）
- `supabase/migrations/*` — migration 追加なし
- `lib/logic/generateShift.ts` — 半休の生成（勤務区間の付与）は既に正しい。参照のみ
- `lib/logic/qualifiedCoverage.ts` — 人員カバレッジは既に半休を在席計上済み（今回対象外）
- `components/shift/WeeklyTransportFull.tsx` — スコープ外（上記）
- `components/shift/ShiftGridFull.tsx` / `ShiftFull.tsx` — シフト表側は既に半休対応済み
- `components/ui/*` — 変更禁止

---

## 3. 表出箇所マップ（空欄禁止）

| 表出箇所 | 内容 |
|---|---|
| サイドバー / ナビ | **該当なし** |
| ダッシュボードのカード | **該当なし** |
| 設定画面 | **該当なし** |
| 通知 / トースト / モーダル | 送迎表の「職員追加」モーダル（`TransportFull` `:1466-1552`）で、半休職員が候補に出るようになる。当日 leave 警告の分岐に am_off/pm_off を明示（「午前のみ/午後のみ勤務」表示） |
| ヘッダー / フッター / パンくず | **該当なし** |
| **メイン表出①：ホワイトボード「本日の出勤」** | `DailyOutputFull` `:801-830`。半休職員が名前 + 勤務時間（例 `09:30〜13:30`）で並ぶ。加えて `PM休`/`AM休` バッジ（色 + テキスト。§7 アクセシビリティ）。出勤者数カウント（`:742`）にも半休が加算される |
| **メイン表出②：送迎表 職員マーク** | `TransportFull`。半休職員が送迎担当マークとして出現。勤務区間内の便にのみ自動割当（午前勤務=迎え中心 / 午後勤務=送り中心に自然に寄る） |
| **メイン表出③：送迎表 出勤人数** | `TransportFull` `:1095` 「👤 出勤 N人」に半休が加算 |
| ロール別表示差 | admin / manager / shift_manager: ホワイトボード・送迎表とも同一表示。employee: これらの画面に非到達（`(admin)`/`(manager)` 配下） |
| モバイル時 | 既存レイアウト維持。ホワイトボードの出勤リストにバッジ 1 個増えるのみ。A3 印刷 CSS への影響なし |

---

## 4. 連動更新ポイント（空欄禁止・「など」禁止）

`[トリガー] → [連動して触るファイル / 関数]` 形式。

| # | トリガー | 連動して触るもの |
|---|---|---|
| 1 | 出勤系判定ヘルパー新設 | → `lib/logic/shiftAssignment.ts`（新規）に `isWorkingAssignmentType` / `isWorkingShift`<br>→ 参照 4 箇所を置換（下記 #2〜#4）<br>→ `docs/reference-map.md` にヘルパー登録 |
| 2 | ホワイトボード出勤者抽出の拡張 | → `DailyOutputFull.tsx:435`（`assignment_type === 'normal'` → `isWorkingShift(sa)`）<br>→ `OnDutyStaff` 型（`:409` 付近）に `assignmentType` 追加<br>→ onDuty の map（`:451-461`）で半休区分を格納。**分割シフト（segment）と半休は排他**（半休は単一区間）である前提を維持<br>→ 表示 `:809-827` に AM休/PM休 バッジ<br>→ 集約コメント `:63` を更新 |
| 3 | 送迎表 候補抽出の拡張 | → `TransportFull.tsx:616`（同上の置換）<br>→ `availableStaffForDay` の `latestEndTime`/`segments`（`:625-634`）は変更不要（半休の時間区間がそのまま入る）<br>→ 追加モーダル leave 判定 `:1466-1476` に am_off/pm_off を「勤務あり（午前/午後のみ）」として扱う分岐を追加（normal と同様に追加可・警告不要） |
| 4 | 送迎自動割当 候補の拡張 | → `generateTransport.ts:114`（workingStaff）<br>→ `generateTransport.ts:360`（selectStaff 候補）<br>→ 時間区間ガード `:372-377`（`sm <= t && t+30 <= em`）は**変更しない**。半休の勤務区間がそのまま渡り「勤務時間内の便のみ候補」を満たす<br>→ 呼出元 `/api/transport/generate` は型・シグネチャ不変のため変更なし（要確認） |
| 5 | ドキュメント | → `docs/reference-map.md`（generateTransport / DailyOutputFull / TransportFull / 新ヘルパー）<br>→ `docs/progress.html`（行追加 → 完了化）<br>→ `docs/features/shift-halfday-availability-reflection.md` 実装メモに相互リンク |

> 補足：本リポジトリに `docs/refmap/registry.tsv` / `build.sh` は**存在しない**（手動運用の `docs/reference-map.md`）。
> `build.sh --check` は実行できない。台帳更新は #1・#5 で手動実施する。

---

## 5. ロール別権限マトリクス

対象操作：ホワイトボード・送迎表での半休職員の閲覧、送迎自動割当。

| ロール | ホワイトボードで半休職員を閲覧 | 送迎表で半休職員を閲覧・割当 | 送迎自動割当（generate） |
|---|---|---|---|
| **admin** | 可（全事業所） | 可 | 可 |
| **manager** | 可（管轄事業所） | 可 | 可 |
| **shift_manager** | 可（主所属1事業所） | 可 | 可 |
| **employee** | 不可（画面非到達） | 不可 | 不可 |

※ 本機能は「どの職員を出勤者として抽出するか」の表示ロジック変更であり、新たな権限判定・RLS 変更は伴わない。
既存の送迎表・ホワイトボードの到達権限（migration 140 で shift_manager も帳票出力可）をそのまま踏襲する。

---

## 6. 既存機能との差分・依存

### 似た機能の有無（統合 / 分離の判断）
**あり。人員カバレッジ（`qualifiedCoverage.ts`）が既に「出勤系（normal/am_off/pm_off）を在席計上」する概念を持つ**
（[generateShift.ts:173-174](../../lib/logic/generateShift.ts#L173) の `isWorking`）。

→ **判断：この「出勤系」判定を共通ヘルパーに切り出して統合する。**
現状 `assignment_type === 'normal'` が 4 箇所（DailyOutputFull / TransportFull / generateTransport×2）に直書きされ、
半休対応がそれぞれ抜けている。前回の billing で算出式の二重定義を `resolveSnackFee` に一本化した教訓と同型で、
判定を 1 箇所（`isWorkingShift`）に集約して抜け漏れを構造的に防ぐ。

### 依存先
- `generateShift.ts` の半休区間付与（PM休=`[出勤,13:30]` / AM休=`[14:30,退勤]`）— **変更しない**。これが正しく動く前提
- `generateTransport.ts` の時間区間ガード（`:372-377`）— **変更しない**。半休の候補時間帯絞りをこれに委ねる
- `shift_assignments.assignment_type` の CHECK（migration 218 で am_off/pm_off 追加済み）

### この変更で影響を受ける既存機能
| 既存機能 | 影響 |
|---|---|
| ホワイトボード 出勤者数 / 送迎表 出勤人数 | 半休が加算される（＝意図した修正） |
| 送迎自動割当の結果 | 半休職員が勤務時間内の便で候補入り。**normal 職員のみの日は結果が一切変わらない**（後方互換） |
| 過去のデータ（am_off/pm_off を含まない月） | 出勤系判定は normal のみヒット → 表示・割当とも従来どおり（後方互換） |
| 送迎の退勤ガード（transport_min_end_time） | 変更なし。午前勤務(PM休)者が午後便に出ないのは意図どおり |
| A3 印刷 / Excel 等の帳票出力 | レイアウト不変（バッジ 1 個増のみ） |

---

## 7. 実装ルール

### 命名（CLAUDE.md §11 準拠）
- ヘルパー: `isWorkingAssignmentType(t: ShiftAssignmentType): boolean` / `isWorkingShift(sa): boolean`（camelCase）
- ファイル: `lib/logic/shiftAssignment.ts`（kebab/camel は既存 lib/logic の慣例に合わせる。`attendance.ts` と同階層）

### 再利用すべき既存コード
- ラベル・色は shift-halfday-availability-reflection.md §7 の既定（am_off=blue系 / pm_off=indigo系、ラベル「AM休」「PM休」）を
  `ShiftGridFull` の `TYPE_CONFIG` から踏襲。新規トークンを追加しない
- 時刻整形は各ファイルの既存 `fmtTime`
- 送迎の時間区間判定は `generateTransport.ts` の `normalizeTimeMinutes` を流用

### デザイントークン
`DailyOutputFull` / `TransportFull` で実際に使われている CSS 変数（`--ink` / `--ink-2` / `--ink-3` / `--rule` / `--accent` 等）に限定。

### アクセシビリティ（CLAUDE.md §9・ろう者向け納品）
- **色のみで伝えない**：半休は バッジ色 + 「AM休」/「PM休」テキスト + 勤務時間 の併記
- 音声通知なし（元々なし）

### モバイル / 印刷
- 既存の A3 印刷 CSS・横スクロール構造を維持。バッジは `print` でも表示（色は color-adjust exact 既存設定に従う）

### コード品質
- `console.log` を残さない / `any` 禁止 / コメントは「なぜ」/ エラーハンドリング省略禁止

---

## 8. 完成条件

### 正常系
- [ ] PM休（午前勤務 09:30〜13:30）の職員が、ホワイトボード「本日の出勤」に時間 + 「PM休」バッジで出る
- [ ] AM休（午後勤務 14:30〜18:00）の職員が同様に出る
- [ ] ホワイトボードの出勤者数に半休が加算される
- [ ] 送迎表に半休職員が候補として出現する
- [ ] 送迎自動割当で、PM休（午前勤務）職員が**午前の便**に候補入りし、午後の送り便には入らない
- [ ] AM休（午後勤務）職員が**午後の便**に候補入りする

### 異常系・境界値
- [ ] normal のみの日は、ホワイトボード・送迎表・自動割当の結果が**変更前と完全一致**（後方互換）
- [ ] am_off/pm_off を含まない過去月が従来どおり表示される
- [ ] 便時刻が半休の勤務区間ぎりぎり（境界 + 30分バッファ）で、既存ガードどおり正しく可否判定される
- [ ] 分割シフト（複数 normal セグメント）の職員が従来どおり集約表示される（半休と混在しない前提の維持）
- [ ] 半休職員に送迎可能な便が無い日でも、ホワイトボード出勤リストには出る（表示と割当は独立）

### ローカル確認（CLAUDE.md §2・§9）
- [ ] `npx tsc --noEmit` クリーン（ShiftAssignmentType 判定の型波及を全解消）
- [ ] `npm run lint` クリーン
- [ ] `npm run dev` で 半休を含む日の ホワイトボード（`/admin/shifts/output/daily`）を目視
- [ ] 同 送迎表（`/admin/shifts/transport` 相当）で半休職員の候補・自動割当を目視
- [ ] PC・タブレット幅で表示確認

### 将来対応（今回やらない）
- 週次送迎表（WeeklyTransportFull）の当日半休反映
- 半休の分単位自由時間設定
