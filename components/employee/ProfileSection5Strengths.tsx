'use client';

import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Employee } from '@/lib/types';

type StrengthFields = Pick<Employee,
  'strength_1' | 'strength_2' | 'strength_3' |
  'weakness_1' | 'weakness_2' | 'weakness_3' |
  'success_experience' | 'success_reason' |
  'struggle_experience' | 'struggle_reason' |
  'suited_tasks' | 'burden_tasks'
>;

interface Props {
  data: StrengthFields;
  onChange: (data: StrengthFields) => void;
}

export function ProfileSection5Strengths({ data, onChange }: Props) {
  function update<K extends keyof StrengthFields>(key: K, value: string) {
    onChange({ ...data, [key]: value || null });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>強み・弱み</CardTitle>
        <CardDescription>すべて任意です</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label className="text-base font-semibold">強み（3つまで）</Label>
          {(['strength_1', 'strength_2', 'strength_3'] as const).map((k, i) => (
            <Input key={k} value={data[k] || ''} onChange={(e) => update(k, e.target.value)} placeholder={`強み ${i + 1}`} />
          ))}
        </div>
        <div className="space-y-3">
          <Label className="text-base font-semibold">課題（3つまで）</Label>
          {(['weakness_1', 'weakness_2', 'weakness_3'] as const).map((k, i) => (
            <Input key={k} value={data[k] || ''} onChange={(e) => update(k, e.target.value)} placeholder={`課題 ${i + 1}`} />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TextArea label="仕事でうまくいった経験" field="success_experience" data={data} onChange={update} />
          <TextArea label="うまくいった理由" field="success_reason" data={data} onChange={update} />
          <TextArea label="仕事で苦戦した経験" field="struggle_experience" data={data} onChange={update} />
          <TextArea label="苦戦した理由" field="struggle_reason" data={data} onChange={update} />
          <TextArea label="力を発揮しやすい業務" field="suited_tasks" data={data} onChange={update} />
          <TextArea label="負荷がかかりやすい業務" field="burden_tasks" data={data} onChange={update} />
        </div>
      </CardContent>
    </Card>
  );
}

function TextArea({ label, field, data, onChange }: {
  label: string; field: keyof StrengthFields;
  data: StrengthFields; onChange: (k: keyof StrengthFields, v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea value={data[field] || ''} onChange={(e) => onChange(field, e.target.value)} rows={3} />
    </div>
  );
}
