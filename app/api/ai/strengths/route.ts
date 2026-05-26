import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runDiagnosis } from '@/lib/ai-client';
import { AI_PROMPTS } from '@/lib/ai-prompts';
import { DIAGNOSIS_FIELDS } from '@/lib/ai-diagnosis-fields';
import { buildAiInputData } from '@/lib/diagnosis-data';
import { MAX_AI_DIAGNOSIS_PER_MONTH } from '@/lib/constants';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { employee_id } = await request.json();

  const { data: employee } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (!employee) return NextResponse.json({ error: '社員が見つかりません' }, { status: 404 });

  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data: usage } = await supabase.from('ai_diagnosis_usage').select('count').eq('tenant_id', employee.tenant_id).eq('year_month', yearMonth).maybeSingle();
  if (usage && usage.count >= MAX_AI_DIAGNOSIS_PER_MONTH) {
    return NextResponse.json({ error: `月間上限（${MAX_AI_DIAGNOSIS_PER_MONTH}回）に達しました` }, { status: 429 });
  }

  // enum カラムは日本語ラベルに変換 (lib/diagnosis-data.ts)
  const data = buildAiInputData(employee as Record<string, unknown>, DIAGNOSIS_FIELDS.strengths);

  const userPrompt = AI_PROMPTS.strengths.user.replace('[ここに回答データを貼る]', JSON.stringify(data, null, 2));

  try {
    const result = await runDiagnosis(userPrompt, AI_PROMPTS.strengths.system);
    await supabase.from('ai_diagnoses').insert({ tenant_id: employee.tenant_id, diagnosis_type: 'strengths', target_employee_ids: [employee_id], result_text: result });
    await supabase.rpc('increment_ai_usage', { p_tenant_id: employee.tenant_id, p_year_month: yearMonth });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ error: 'AI診断に失敗しました' }, { status: 500 });
  }
}
