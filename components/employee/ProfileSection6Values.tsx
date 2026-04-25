'use client';

import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Employee } from '@/lib/types';

type ValueFields = Pick<Employee,
  'workplace_values' | 'ideal_boss_colleague' | 'disliked_atmosphere' |
  'growth_goal' | 'preferred_evaluation' | 'safe_environment' |
  'strengths_self_reported' | 'work_style_preference'
>;

interface Props {
  data: ValueFields;
  onChange: (data: ValueFields) => void;
}

const fields: { key: keyof ValueFields; label: string; placeholder: string }[] = [
  { key: 'workplace_values', label: '職場で大切だと思うこと', placeholder: '働く上で重視していること' },
  { key: 'ideal_boss_colleague', label: '理想の上司や同僚', placeholder: 'どんな人と一緒に働きたいか' },
  { key: 'disliked_atmosphere', label: '苦手な職場の雰囲気', placeholder: '避けたい環境や雰囲気' },
  { key: 'growth_goal', label: '今後どのように成長したいか', placeholder: 'キャリアの目標や展望' },
  { key: 'preferred_evaluation', label: 'どのような評価をされるとうれしいか', placeholder: '望む評価の仕方' },
  { key: 'safe_environment', label: '安心して力を発揮しやすい環境', placeholder: 'パフォーマンスが上がる環境' },
  { key: 'strengths_self_reported', label: '自分で感じる強み', placeholder: '自己認識している強み' },
  { key: 'work_style_preference', label: '働き方の好み（自由記述）', placeholder: '理想の働き方' },
];

export function ProfileSection6Values({ data, onChange }: Props) {
  function update(key: keyof ValueFields, value: string) {
    onChange({ ...data, [key]: value || null });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>価値観・カルチャー</CardTitle>
        <CardDescription>すべて任意です</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label>{f.label}</Label>
            <Textarea
              value={data[f.key] || ''}
              onChange={(e) => update(f.key, e.target.value)}
              placeholder={f.placeholder}
              rows={2}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
