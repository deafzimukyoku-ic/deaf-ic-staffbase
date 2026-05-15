'use client';

import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Employee } from '@/lib/types';
import { WORK_STYLE_FIELDS } from '@/lib/profile-options';

type WorkStyleFields = Pick<Employee,
  'work_style_solo_vs_team' | 'work_style_clear_vs_autonomy' |
  'work_style_stable_vs_change' | 'work_style_think_vs_act' |
  'multitask_ability' | 'detail_orientation'
>;

interface Props {
  data: WorkStyleFields;
  onChange: (data: WorkStyleFields) => void;
}

export function ProfileSection3WorkStyle({ data, onChange }: Props) {
  function update(key: keyof WorkStyleFields, value: string) {
    onChange({ ...data, [key]: value || null });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>働き方の好み</CardTitle>
        <CardDescription>すべて任意です</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {WORK_STYLE_FIELDS.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label>{f.label}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={data[f.key] || ''}
              onChange={(e) => update(f.key, e.target.value)}
            >
              <option value="">未選択</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
