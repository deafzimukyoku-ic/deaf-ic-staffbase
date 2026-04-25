'use client';

import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Employee } from '@/lib/types';

type TeamFields = Pick<Employee,
  'team_role_preference' | 'easy_to_work_with' | 'hard_to_work_with' | 'team_mindset'
>;

interface Props {
  data: TeamFields;
  onChange: (data: TeamFields) => void;
}

const roleOptions = [
  { value: 'idea', label: 'アイデア出し役' },
  { value: 'coordinator', label: 'まとめ役' },
  { value: 'executor', label: '実行役' },
  { value: 'supporter', label: 'サポート役' },
];

export function ProfileSection7Team({ data, onChange }: Props) {
  function update<K extends keyof TeamFields>(key: K, value: TeamFields[K]) {
    onChange({ ...data, [key]: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>チーム相性</CardTitle>
        <CardDescription>すべて任意です</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>チームでの役割の好み</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            value={data.team_role_preference || ''}
            onChange={(e) => update('team_role_preference', e.target.value || null)}
          >
            <option value="">未選択</option>
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>やりやすいタイプの人</Label>
          <Textarea
            value={data.easy_to_work_with || ''}
            onChange={(e) => update('easy_to_work_with', e.target.value || null)}
            placeholder="一緒に仕事がしやすい人のタイプ"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>難しさを感じやすいタイプの人</Label>
          <Textarea
            value={data.hard_to_work_with || ''}
            onChange={(e) => update('hard_to_work_with', e.target.value || null)}
            placeholder="一緒に仕事をするのが難しいと感じる人のタイプ"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>チームで意識していること</Label>
          <Textarea
            value={data.team_mindset || ''}
            onChange={(e) => update('team_mindset', e.target.value || null)}
            placeholder="チームワークで大事にしていること"
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  );
}
