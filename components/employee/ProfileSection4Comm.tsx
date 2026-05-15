'use client';

import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Employee } from '@/lib/types';
import { COMM_SELECT_FIELDS } from '@/lib/profile-options';

type CommFields = Pick<Employee,
  'comm_conclusion_vs_context' | 'comm_consult_timing' | 'comm_feedback_preference' |
  'comm_channel_preference' | 'meeting_behavior' | 'relationship_notes'
>;

interface Props {
  data: CommFields;
  onChange: (data: CommFields) => void;
}

export function ProfileSection4Comm({ data, onChange }: Props) {
  function update<K extends keyof CommFields>(key: K, value: CommFields[K]) {
    onChange({ ...data, [key]: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>コミュニケーション傾向</CardTitle>
        <CardDescription>すべて任意です</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {COMM_SELECT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label>{f.label}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={data[f.key] || ''}
              onChange={(e) => update(f.key, e.target.value || null)}
            >
              <option value="">未選択</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
        <div className="space-y-2">
          <Label>人間関係で気をつけていること</Label>
          <Textarea
            value={data.relationship_notes || ''}
            onChange={(e) => update('relationship_notes', e.target.value || null)}
            placeholder="対人関係で意識していること"
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  );
}
