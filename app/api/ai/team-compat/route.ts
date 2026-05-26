import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runDiagnosis } from '@/lib/ai-client';
import { AI_PROMPTS } from '@/lib/ai-prompts';
import { DIAGNOSIS_FIELDS } from '@/lib/ai-diagnosis-fields';
import { buildAiInputData } from '@/lib/diagnosis-data';
import { MAX_AI_DIAGNOSIS_PER_MONTH } from '@/lib/constants';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { employee_ids } = await request.json();

  if (!employee_ids || employee_ids.length < 2) {
    return NextResponse.json({ error: '2名以上の社員を選択してください' }, { status: 400 });
  }

  const { data: employees } = await supabase.from('employees').select('*').in('id', employee_ids);
  if (!employees || employees.length < 2) {
    return NextResponse.json({ error: '社員データが見つかりません' }, { status: 404 });
  }

  const tenantId = employees[0].tenant_id;
  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data: usage } = await supabase.from('ai_diagnosis_usage').select('count').eq('tenant_id', tenantId).eq('year_month', yearMonth).maybeSingle();
  if (usage && usage.count >= MAX_AI_DIAGNOSIS_PER_MONTH) {
    return NextResponse.json({ error: `月間上限（${MAX_AI_DIAGNOSIS_PER_MONTH}回）に達しました` }, { status: 429 });
  }

  /* enum カラム ('context' / 'organized' 等) は profileOptionLabel で日本語化してから渡す。
     詳細: 本リポ docs/error-log.md (ORIGAMI で 2026-05-26 に発覚し本家系にも移植) */
  const teamData = employees.map((emp) =>
    buildAiInputData(emp as Record<string, unknown>, DIAGNOSIS_FIELDS.teamCompat),
  );

  const userPrompt = AI_PROMPTS.teamCompat.user.replace('[ここに回答データを貼る]', JSON.stringify(teamData, null, 2));

  try {
    const result = await runDiagnosis(userPrompt, AI_PROMPTS.teamCompat.system);
    await supabase.from('ai_diagnoses').insert({ tenant_id: tenantId, diagnosis_type: 'team_compat', target_employee_ids: employee_ids, result_text: result });
    await supabase.rpc('increment_ai_usage', { p_tenant_id: tenantId, p_year_month: yearMonth });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ error: 'AI診断に失敗しました' }, { status: 500 });
  }
}
