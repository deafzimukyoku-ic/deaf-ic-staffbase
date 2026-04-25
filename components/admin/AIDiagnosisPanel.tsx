'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MAX_AI_DIAGNOSIS_PER_MONTH } from '@/lib/constants';
import { toast } from 'sonner';

interface Props {
  employeeId: string;
  tenantId: string;
}

interface DiagnosisResult {
  id: string;
  diagnosis_type: string;
  result_text: string;
  created_at: string;
}

const typeLabels: Record<string, string> = {
  personality: '性格・タイプ',
  strengths: '強み・弱み',
  culture_fit: 'カルチャーフィット',
  team_compat: 'チーム相性',
};

const typeColors: Record<string, string> = {
  personality: 'bg-diletto-blue/10 text-diletto-blue border-diletto-blue/20',
  strengths: 'bg-diletto-green/10 text-diletto-green border-diletto-green/20',
  culture_fit: 'bg-diletto-gold/[0.1] text-diletto-gold border-diletto-gold/20',
  team_compat: 'bg-diletto-gray/10 text-diletto-gray border-diletto-gray/20',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}年${mo}月${day}日 ${h}時${min}分`;
}

const bigFiveLabels: Record<string, string> = {
  openness: '開放性',
  conscientiousness: '誠実性',
  extraversion: '外向性',
  agreeableness: '協調性',
  neuroticism: '神経症傾向',
};

const levelLabels: Record<string, string> = {
  high: '高',
  mid: '中',
  low: '低',
  unknown: '不明',
};

const confidenceLabels: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const fitLevelLabels: Record<string, string> = {
  high: '高い',
  medium: '中程度',
  low: '低い',
  unknown: '不明',
};

function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    // コードフェンス (```json ... ```) を除去してリトライ
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// --- personality ---
function PersonalityView({ data }: { data: Record<string, unknown> }) {
  const bigFive = data.big_five_tendency as Record<string, { level: string; evidence: string }> | undefined;
  const strengths = data.strengths as { point: string; evidence: string }[] | undefined;
  const watchPoints = data.watch_points as { point: string; evidence: string }[] | undefined;

  return (
    <div className="space-y-4 text-sm">
      {data.summary ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">概要</p>
          <p className="text-diletto-gray leading-relaxed">{String(data.summary)}</p>
        </div>
      ) : null}

      {bigFive && (
        <div>
          <p className="font-medium text-diletto-ink mb-2">Big Five 傾向</p>
          <div className="grid gap-2">
            {Object.entries(bigFive).map(([key, val]) => (
              val && (
                <div key={key} className="flex items-start gap-2 rounded-md border border-diletto-gray/10 p-2">
                  <Badge variant="outline" className="shrink-0 text-xs mt-0.5">
                    {bigFiveLabels[key] || key}
                  </Badge>
                  <div className="min-w-0">
                    <span className="font-medium text-xs">{levelLabels[val.level] || val.level}</span>
                    {val.evidence && (
                      <p className="text-xs text-diletto-gray mt-0.5">{val.evidence}</p>
                    )}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {strengths && strengths.length > 0 && (
        <div>
          <p className="font-medium text-diletto-ink mb-1">強み</p>
          <ul className="space-y-1">
            {strengths.map((s, i) => (
              <li key={i} className="text-diletto-gray">
                <span className="font-medium text-diletto-ink">{s.point}</span>
                {s.evidence && <span className="text-xs ml-1">({s.evidence})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {watchPoints && watchPoints.length > 0 && (
        <div>
          <p className="font-medium text-diletto-ink mb-1">配慮ポイント</p>
          <ul className="space-y-1">
            {watchPoints.map((w, i) => (
              <li key={i} className="text-diletto-gray">
                <span className="font-medium text-diletto-ink">{w.point}</span>
                {w.evidence && <span className="text-xs ml-1">({w.evidence})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.communication_tips ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">コミュニケーションのヒント</p>
          <p className="text-diletto-gray">{String(data.communication_tips)}</p>
        </div>
      ) : null}

      {data.management_implications ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">マネジメント上の示唆</p>
          <p className="text-diletto-gray">{String(data.management_implications)}</p>
        </div>
      ) : null}

      <DiagnosisFooter confidence={data.confidence as string} caveat={data.caveat as string} />
    </div>
  );
}

// --- strengths ---
function StrengthsView({ data }: { data: Record<string, unknown> }) {
  const strengths = data.strengths as { point: string; description: string; evidence: string }[] | undefined;
  const growthAreas = data.growth_areas as { point: string; description: string; evidence: string }[] | undefined;

  return (
    <div className="space-y-4 text-sm">
      {data.overall_assessment ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">総合評価</p>
          <p className="text-diletto-gray leading-relaxed">{String(data.overall_assessment)}</p>
        </div>
      ) : null}

      {strengths && strengths.length > 0 && (
        <div>
          <p className="font-medium text-diletto-ink mb-2">強み</p>
          <div className="space-y-2">
            {strengths.map((s, i) => (
              <div key={i} className="rounded-md border border-diletto-green/20 bg-diletto-green/[0.03] p-2">
                <p className="font-medium text-diletto-ink">{s.point}</p>
                {s.description && <p className="text-xs text-diletto-gray mt-0.5">{s.description}</p>}
                {s.evidence && <p className="text-xs text-diletto-gray-light mt-0.5">根拠: {s.evidence}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {growthAreas && growthAreas.length > 0 && (
        <div>
          <p className="font-medium text-diletto-ink mb-2">成長課題</p>
          <div className="space-y-2">
            {growthAreas.map((g, i) => (
              <div key={i} className="rounded-md border border-diletto-gold/20 bg-diletto-gold/[0.03] p-2">
                <p className="font-medium text-diletto-ink">{g.point}</p>
                {g.description && <p className="text-xs text-diletto-gray mt-0.5">{g.description}</p>}
                {g.evidence && <p className="text-xs text-diletto-gray-light mt-0.5">根拠: {g.evidence}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recommended_roles ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">推奨される業務・役割</p>
          <p className="text-diletto-gray">{String(data.recommended_roles)}</p>
        </div>
      ) : null}

      {data.development_tips ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">育成のポイント</p>
          <p className="text-diletto-gray">{String(data.development_tips)}</p>
        </div>
      ) : null}

      <DiagnosisFooter confidence={data.confidence as string} caveat={data.caveat as string} />
    </div>
  );
}

// --- culture_fit ---
function CultureFitView({ data }: { data: Record<string, unknown> }) {
  const alignments = data.alignments as { company_value: string; point: string; evidence: string }[] | undefined;
  const gaps = data.gaps as { company_value: string; point: string; evidence: string }[] | undefined;

  return (
    <div className="space-y-4 text-sm">
      {data.fit_summary ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">フィット概要</p>
          <p className="text-diletto-gray leading-relaxed">{String(data.fit_summary)}</p>
        </div>
      ) : null}

      {data.fit_level ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-diletto-gray">フィット度:</span>
          <Badge variant="outline">{fitLevelLabels[data.fit_level as string] || String(data.fit_level)}</Badge>
        </div>
      ) : null}

      {alignments && alignments.length > 0 && (
        <div>
          <p className="font-medium text-diletto-ink mb-2">合致点</p>
          <div className="space-y-2">
            {alignments.map((a, i) => (
              <div key={i} className="rounded-md border border-diletto-green/20 bg-diletto-green/[0.03] p-2">
                <p className="text-xs text-diletto-gray-light mb-0.5">{a.company_value}</p>
                <p className="font-medium text-diletto-ink">{a.point}</p>
                {a.evidence && <p className="text-xs text-diletto-gray mt-0.5">根拠: {a.evidence}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {gaps && gaps.length > 0 && (
        <div>
          <p className="font-medium text-diletto-ink mb-2">ギャップ</p>
          <div className="space-y-2">
            {gaps.map((g, i) => (
              <div key={i} className="rounded-md border border-diletto-gold/20 bg-diletto-gold/[0.03] p-2">
                <p className="text-xs text-diletto-gray-light mb-0.5">{g.company_value}</p>
                <p className="font-medium text-diletto-ink">{g.point}</p>
                {g.evidence && <p className="text-xs text-diletto-gray mt-0.5">根拠: {g.evidence}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.expected_contributions ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">期待される貢献</p>
          <p className="text-diletto-gray">{String(data.expected_contributions)}</p>
        </div>
      ) : null}

      {data.support_needed ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">サポートが望ましい点</p>
          <p className="text-diletto-gray">{String(data.support_needed)}</p>
        </div>
      ) : null}

      {data.placement_suggestions ? (
        <div>
          <p className="font-medium text-diletto-ink mb-1">配属・マネジメントへの提案</p>
          <p className="text-diletto-gray">{String(data.placement_suggestions)}</p>
        </div>
      ) : null}

      <DiagnosisFooter confidence={data.confidence as string} caveat={data.caveat as string} />
    </div>
  );
}

// --- 共通フッター ---
function DiagnosisFooter({ confidence, caveat }: { confidence?: string; caveat?: string }) {
  return (
    <div className="border-t border-diletto-gray/10 pt-2 mt-2 space-y-1">
      {confidence && (
        <p className="text-xs text-diletto-gray-light">
          信頼度: {confidenceLabels[confidence] || confidence}
        </p>
      )}
      {caveat && (
        <p className="text-xs text-diletto-gray-light italic">{caveat}</p>
      )}
    </div>
  );
}

// --- 結果レンダラー ---
function DiagnosisResultView({ type, resultText }: { type: string; resultText: string }) {
  const parsed = tryParseJSON(resultText);

  if (!parsed || typeof parsed !== 'object') {
    return <div className="whitespace-pre-wrap text-sm leading-relaxed">{resultText}</div>;
  }

  const data = parsed as Record<string, unknown>;

  switch (type) {
    case 'personality':
      return <PersonalityView data={data} />;
    case 'strengths':
      return <StrengthsView data={data} />;
    case 'culture_fit':
      return <CultureFitView data={data} />;
    default:
      return <div className="whitespace-pre-wrap text-sm leading-relaxed">{resultText}</div>;
  }
}

export function AIDiagnosisPanel({ employeeId, tenantId }: Props) {
  const [results, setResults] = useState<DiagnosisResult[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [usageCount, setUsageCount] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: diagnoses } = await supabase
        .from('ai_diagnoses')
        .select('*')
        .contains('target_employee_ids', [employeeId])
        .order('created_at', { ascending: false });

      const loaded = (diagnoses as DiagnosisResult[]) || [];
      setResults(loaded);
      // 各タイプの最新結果のみデフォルトで開く
      const latestByType = new Set<string>();
      const initialOpen = new Set<string>();
      for (const d of loaded) {
        if (!latestByType.has(d.diagnosis_type)) {
          latestByType.add(d.diagnosis_type);
          initialOpen.add(d.id);
        }
      }
      setOpenIds(initialOpen);

      const yearMonth = new Date().toISOString().slice(0, 7);
      const { data: usage } = await supabase
        .from('ai_diagnosis_usage')
        .select('count')
        .eq('tenant_id', tenantId)
        .eq('year_month', yearMonth)
        .maybeSingle();

      setUsageCount(usage?.count || 0);
    }
    load();
  }, [employeeId, tenantId]);

  async function runDiagnosis(type: string) {
    setRunning(type);

    const endpoint = `/api/ai/${type.replace('_', '-')}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId }),
    });

    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || '診断に失敗しました');
      setRunning(null);
      return;
    }

    const newId = crypto.randomUUID();
    setResults((prev) => [{
      id: newId,
      diagnosis_type: type,
      result_text: data.result,
      created_at: new Date().toISOString(),
    }, ...prev]);
    setOpenIds((prev) => new Set([...prev, newId]));

    setUsageCount((prev) => prev + 1);
    toast.success(`${typeLabels[type]}診断が完了しました`);
    setRunning(null);
  }

  const atLimit = usageCount >= MAX_AI_DIAGNOSIS_PER_MONTH;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI診断</CardTitle>
          <CardDescription>
            今月の使用回数: {usageCount} / {MAX_AI_DIAGNOSIS_PER_MONTH}
            {atLimit && <span className="text-diletto-red ml-2">（上限に達しました）</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(['personality', 'strengths', 'culture_fit'] as const).map((type) => (
              <Button
                key={type}
                variant="outline"
                size="sm"
                onClick={() => runDiagnosis(type)}
                disabled={atLimit || running !== null}
              >
                {running === type ? '診断中...' : typeLabels[type]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {results.map((r) => {
        const isOpen = openIds.has(r.id);
        return (
          <Card key={r.id}>
            <button
              type="button"
              className="w-full text-left px-6 py-4 flex items-center justify-between"
              onClick={() => setOpenIds((prev) => {
                const next = new Set(prev);
                if (next.has(r.id)) next.delete(r.id);
                else next.add(r.id);
                return next;
              })}
            >
              <div className="flex flex-col gap-1">
                <span className={`inline-flex items-center self-start rounded-md border px-3 py-1 text-sm font-semibold ${typeColors[r.diagnosis_type] || 'bg-diletto-gray/10 text-diletto-gray border-diletto-gray/20'}`}>
                  {typeLabels[r.diagnosis_type]}
                </span>
                <span className="text-sm text-diletto-ink">
                  {formatDateTime(r.created_at)}
                </span>
              </div>
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`text-diletto-gray shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {isOpen && (
              <CardContent className="pt-0">
                <DiagnosisResultView type={r.diagnosis_type} resultText={r.result_text} />
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
