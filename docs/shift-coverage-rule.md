# シフト人員カバレッジ判定ルール（実運用 Excel/VBA 由来・正本）

> **出典**: 現場運用の Excel マクロ「作　シフト：有資格者カウント」（ユーザー提供 2026-06-17）
> **位置づけ**: 「半休者は休み時間によって人員カウントが変わる」の**正本ロジック**。
> Web 版シフト（deaf-ic / diletto）の人員チェックはこの時間区間ベース判定に合わせる。
> 現行 `lib/logic/qualifiedCoverage.ts` は `assignment_type !== 'normal'` を一律除外する
> フラット集計で、**このルールと不一致**。本ルールに置換する。

## 時間定数

| 名前 | 値 | 意味 |
|---|---|---|
| COVER_START | 10:30 | コア時間帯 開始（最小要件を満たすべき帯の始まり） |
| COVER_END | 16:30 | コア時間帯 終了 |
| FULL_START | 9:30 | フル勤務 開始 |
| FULL_END | 18:00 | フル勤務 終了 |
| INTERVAL | 30分 | スロット刻み |

各職員は**実勤務時間区間 (start, end)** を持つ。区間が帯と重なる分だけカウントされる
（＝半休で区間が短いと、その人は重なるスロットでしか数えられない）。

## 3 つの判定（各日ごとに算出）

### 1. 有資格者カウント `CountQualified`
- 有資格者のうち、勤務区間が**コア帯 [10:30, 16:30) と少しでも重なる**人数。
- 条件: `start < COVER_END AND end > COVER_START`

### 2. 最小要件チェック `CheckMinCoverage`（常時2名）
- コア帯を30分刻みで走査。各スロット `t` で在席人数 = `start < t+30m AND end > t`。
- **どこか1スロットでも 2名未満 → 「不足」**。全スロット2名以上なら、最小在席数を返す。

### 3. 追加要員チェック `NeedAdditional`（3名／時間ルール）
- まず**終日カバー人数** `CountFullCover` = コア帯を完全内包する人（`start ≤ 10:30 AND end ≥ 16:30`）。
- 分岐:
  - 終日カバー **2名以上** → コア帯で**3名同時在席が連続2時間以上**必要
  - 終日カバー **1名** → **3名同時在席が連続1時間以上**必要
  - 終日カバー **0名** → 「不足」（無条件）
- `HasTripleOverlap`: コア帯を1分刻みで走査し、在席3名以上が `needH×60` 分連続したら充足。

## 半休（AM休/PM休）の勤務区間（Web 版で確定が必要）

VBA は各人の区間 (start,end) を入力として受け取るだけで、半休者の区間そのものは
Excel 側で手入力されている。Web 版で自動生成する場合、半休の区間を定義する必要がある：

- **PM休（午後休）** = 午前のみ勤務 → 区間 `[FULL_START, X]`（例 9:30〜?）
- **AM休（午前休）** = 午後のみ勤務 → 区間 `[X, FULL_END]`（例 ?〜18:00）
- 境界 `X`（昼の区切り）は**未確定 → ユーザー確認事項**（12:00 / 13:00 / 13:30 など）

## Web 実装への対応方針（要約）

- `qualifiedCoverage.ts` を**時間区間ベース**に置換（上記3判定）。
- 入力は各職員の当日の (start_time, end_time)。
  - normal = フル区間（職員の default_start/end、無ければ 9:30/18:00）
  - am_off = `[X, FULL_END]`（午後勤務）
  - pm_off = `[FULL_START, X]`（午前勤務）
  - off / requested_off / paid_leave / public_holiday = 不在（区間なし）
- グリッドの人員警告（understaffed / no_qualified）も本ルールに合わせる。

## 原典 VBA（保全用・改変しない）

```vba
'――――――――――――――――――――――――
' 作　シフト：有資格者カウント
'――――――――――――――――――――――――
Option Explicit

'――― 時間定数 ―――
Private Const COVER_START As Date = #10:30:00 AM#
Private Const COVER_END   As Date = #4:30:00 PM#
Private Const FULL_START  As Date = #9:30:00 AM#
Private Const FULL_END    As Date = #6:00:00 PM#
Private Const INTERVAL    As Double = 1 / 48    ' 30分刻み

Public Sub RunAllCoverageChecks()
    Dim ws As Worksheet
    Dim rowQ As Long, rowT As Long, rowR As Long, lastCol As Long
    Dim fr As Long, lr As Long
    Dim col As Long

    Set ws = ThisWorkbook.Worksheets("作　シフト")
    rowQ = ws.Columns("A").Find("有資格者", LookAt:=xlWhole).Row
    rowT = ws.Columns("A").Find("提供時間", LookAt:=xlWhole).Row
    rowR = ws.Columns("A").Find("休憩", LookAt:=xlWhole).Row
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    Call SetShiftsBounds(ws, fr, lr)

    Dim shiftsCache() As Collection
    ReDim shiftsCache(2 To lastCol)
    For col = 2 To lastCol
        Set shiftsCache(col) = ParseShifts(ws, fr, lr, col)
    Next

    Dim minReq() As Variant
    ReDim minReq(2 To lastCol)

    ' １）有資格者カウント
    For col = 2 To lastCol
        ws.Cells(rowQ, col).ClearContents
        ws.Cells(rowQ, col).Value = CountQualified(shiftsCache(col))
    Next

    ' ２）最小要件チェック（常時2名）
    For col = 2 To lastCol
        minReq(col) = CheckMinCoverage(shiftsCache(col))
        ws.Cells(rowT, col).ClearContents
        ws.Cells(rowT, col).Value = minReq(col)
    Next

    ' ３）追加要員チェック（3名／時間ルール）
    For col = 2 To lastCol
        ws.Cells(rowR, col).ClearContents
        If NeedAdditional(shiftsCache(col)) Then
            ws.Cells(rowR, col).Value = "不足"
        Else
            ws.Cells(rowR, col).Value = "OK"
        End If
    Next
End Sub

' 有資格者シフト重複カウント
Private Function CountQualified(shifts As Collection) As Long
    Dim iv As Variant, cnt As Long
    cnt = 0
    For Each iv In shifts
        If iv(0) < COVER_END And iv(1) > COVER_START Then cnt = cnt + 1
    Next
    CountQualified = cnt
End Function

' 最小要件チェック（常時2名）
Private Function CheckMinCoverage(shifts As Collection) As Variant
    Dim t As Date, pc As Long, minPc As Long
    minPc = 999
    For t = COVER_START To COVER_END - INTERVAL Step INTERVAL
        pc = 0
        Dim iv As Variant
        For Each iv In shifts
            If iv(0) < t + INTERVAL And iv(1) > t Then pc = pc + 1
        Next
        If pc < 2 Then
            CheckMinCoverage = "不足"
            Exit Function
        End If
        If pc < minPc Then minPc = pc
    Next
    CheckMinCoverage = minPc
End Function

' 追加要員チェック判定。True = 不足
Private Function NeedAdditional(shifts As Collection) As Boolean
    Dim fullCnt As Long
    fullCnt = CountFullCover(shifts)  ' 10:30～16:30を完全カバーする人数

    Dim needH As Double
    Select Case fullCnt
        Case Is >= 2
            needH = 2
        Case 1
            needH = 1
        Case Else
            NeedAdditional = True
            Exit Function
    End Select

    NeedAdditional = Not HasTripleOverlap( _
        shifts, COVER_START, COVER_END, needH _
    )
End Function

' FULL_START～FULL_END を完全カバーするシフト数
Private Function CountFullCover(shifts As Collection) As Long
    Dim iv As Variant, cnt As Long
    For Each iv In shifts
        If iv(0) <= COVER_START And iv(1) >= COVER_END Then cnt = cnt + 1
    Next
    CountFullCover = cnt
End Function

' 3名同時重複チェック（分単位）
Private Function HasTripleOverlap( _
    shifts As Collection, _
    sT As Date, eT As Date, needH As Double _
) As Boolean
    Dim t As Date, cnt As Long, consecMin As Long, iv As Variant
    For t = sT To eT Step TimeSerial(0, 1, 0)
        cnt = 0
        For Each iv In shifts
            If iv(0) < t + TimeSerial(0, 1, 0) And iv(1) > t Then cnt = cnt + 1
        Next
        If cnt >= 3 Then
            consecMin = consecMin + 1
            If consecMin >= needH * 60 Then
                HasTripleOverlap = True
                Exit Function
            End If
        Else
            consecMin = 0
        End If
    Next
    HasTripleOverlap = False
End Function

Private Sub SetShiftsBounds(ws As Worksheet, ByRef firstR As Long, ByRef lastR As Long)
    Dim u As Range
    Set u = ws.Columns("A").Find("利用者数", LookAt:=xlWhole)
    If u Is Nothing Then Err.Raise 999, , "Cannot find '利用者数'"
    firstR = 3: lastR = u.Row - 1
End Sub

Private Function ParseShifts( _
    ws As Worksheet, topR As Long, botR As Long, cNum As Long _
) As Collection
    Dim res As New Collection, c As Range, txt As String, parts As Variant
    Dim s0 As Date, e0 As Date
    For Each c In ws.Range(ws.Cells(topR, cNum), ws.Cells(botR, cNum))
        If c.Interior.ColorIndex = xlNone And c.DisplayFormat.Interior.ColorIndex = xlNone Then GoTo Skip
        txt = Replace(Replace(Replace(CStr(c.Value), vbCrLf, "~"), vbCr, "~"), vbLf, "~")
        txt = StrConv(txt, vbNarrow)
        txt = Replace(txt, "～", "~"): txt = Replace(txt, "：", ":")
        If InStr(txt, "~") > 0 Then parts = Split(txt, "~") Else parts = Split(txt, "-")
        If UBound(parts) >= 1 Then
            On Error Resume Next
            s0 = TimeValue(Trim(parts(0)))
            e0 = TimeValue(Trim(parts(1)))
            On Error GoTo 0
            If e0 > s0 Then res.Add Array(s0, e0)
        End If
Skip:
    Next
    Set ParseShifts = res
End Function
```
