import Anthropic from '@anthropic-ai/sdk';
import type { ParsedScheduleEntry } from '@/lib/types';

/**
 * Claude API による PDF 解析（shift-puzzle 忠実移植）
 * - モデル: claude-sonnet-4-20250514（CLAUDE.md 8章で固定指定）
 * - max_tokens: 4000
 * - PDFをbase64エンコードして送信、JSON形式で利用予定を抽出
 *
 * ANTHROPIC_API_KEY が未設定の場合はモックデータを返す（開発用）
 */

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_MAX_TOKENS = 4000;

const PARSE_PROMPT = `以下のPDFは放課後等デイサービスの利用予定表です。
児童ごと・日付ごとの利用予定を抽出し、以下のJSON形式で返してください。
JSON以外のテキストは一切含めないでください。

フォーマット:
[
  {
    "child_name": "児童名",
    "date": "YYYY-MM-DD",
    "pickup_time": "HH:MM" または null,
    "dropoff_time": "HH:MM" または null,
    "area_label": "エリア名" または null
  }
]

注意:
- 利用がない日は含めないでください
- 「追・休」「定・休」などの特殊ステータスの日は pickup_time と dropoff_time を null にし、area_label にステータスを入れてください
- 時間は24時間形式で返してください（例: 14:30）
- 児童名は漢字のまま返してください`;

function getMockResult(): ParsedScheduleEntry[] {
  return [
    { child_name: '川島舞桜', date: '2026-04-01', pickup_time: '11:20', dropoff_time: '16:00', area_label: null },
    { child_name: '川島舞桜', date: '2026-04-02', pickup_time: '11:20', dropoff_time: '16:00', area_label: null },
    { child_name: '川島舞桜', date: '2026-04-03', pickup_time: '11:20', dropoff_time: '16:00', area_label: null },
    { child_name: '川島颯斗', date: '2026-04-01', pickup_time: '11:20', dropoff_time: '16:00', area_label: null },
    { child_name: '川島颯斗', date: '2026-04-02', pickup_time: '11:20', dropoff_time: '16:00', area_label: null },
    { child_name: '黒川蒼斗', date: '2026-04-01', pickup_time: null, dropoff_time: null, area_label: null },
    { child_name: '清水隼音', date: '2026-04-01', pickup_time: '11:30', dropoff_time: '16:00', area_label: null },
    { child_name: '清水隼音', date: '2026-04-03', pickup_time: '11:30', dropoff_time: '16:00', area_label: null },
    { child_name: '滝川希', date: '2026-04-01', pickup_time: '13:50', dropoff_time: '16:30', area_label: null },
    { child_name: '滝川希', date: '2026-04-02', pickup_time: '13:50', dropoff_time: '16:30', area_label: null },
    { child_name: '滝川希', date: '2026-04-03', pickup_time: null, dropoff_time: null, area_label: '追・休' },
    { child_name: '竹内碧子', date: '2026-04-01', pickup_time: '12:30', dropoff_time: '16:30', area_label: null },
    { child_name: '竹内碧子', date: '2026-04-02', pickup_time: null, dropoff_time: null, area_label: '追・休' },
    { child_name: '竹内碧子', date: '2026-04-03', pickup_time: '13:00', dropoff_time: '16:30', area_label: null },
    { child_name: '板倉千夏', date: '2026-04-02', pickup_time: '10:30', dropoff_time: '16:30', area_label: null },
    { child_name: '板倉千夏', date: '2026-04-03', pickup_time: '10:30', dropoff_time: '16:30', area_label: null },
  ];
}

export async function parsePdfToSchedule(
  pdfBase64: string,
  mediaType: 'application/pdf' = 'application/pdf'
): Promise<{ entries: ParsedScheduleEntry[]; isMock: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { entries: getMockResult(), isMock: true };
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: PARSE_PROMPT,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude APIからテキスト応答が返されませんでした');
  }

  try {
    const parsed = JSON.parse(textBlock.text) as ParsedScheduleEntry[];
    if (!Array.isArray(parsed)) {
      throw new Error('応答がJSON配列ではありません');
    }
    return { entries: parsed, isMock: false };
  } catch (parseError) {
    throw new Error(
      `PDF解析結果のJSONパースに失敗しました。Claude APIの応答を確認してください。\n${
        parseError instanceof Error ? parseError.message : String(parseError)
      }`
    );
  }
}
