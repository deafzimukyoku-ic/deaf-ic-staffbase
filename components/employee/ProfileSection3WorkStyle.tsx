'use client';

import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Employee } from '@/lib/types';

type WorkStyleFields = Pick<Employee,
  'work_style_solo_vs_team' | 'work_style_clear_vs_autonomy' |
  'work_style_stable_vs_change' | 'work_style_think_vs_act' |
  'multitask_ability' | 'detail_orientation'
>;

interface Props {
  data: WorkStyleFields;
  onChange: (data: WorkStyleFields) => void;
}

const selectFields: { key: keyof WorkStyleFields; label: string; options: { value: string; label: string }[] }[] = [
  { key: 'work_style_solo_vs_team', label: '個人作業 vs チーム作業', options: [
    { value: 'solo', label: '個人作業が好き' }, { value: 'team', label: 'チーム作業が好き' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'work_style_clear_vs_autonomy', label: '明確な指示 vs 自律的に', options: [
    { value: 'clear', label: '明確な指示がほしい' }, { value: 'autonomy', label: '自律的に進めたい' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'work_style_stable_vs_change', label: '安定志向 vs 変化志向', options: [
    { value: 'stable', label: '安定した環境がいい' }, { value: 'change', label: '変化がある方がいい' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'work_style_think_vs_act', label: 'じっくり考える vs すぐ行動', options: [
    { value: 'think', label: 'じっくり考えてから' }, { value: 'act', label: 'まず行動してみる' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'multitask_ability', label: 'マルチタスク', options: [
    { value: 'good', label: '得意' }, { value: 'weak', label: '苦手' }, { value: 'neutral', label: 'どちらでもない' },
  ]},
  { key: 'detail_orientation', label: '細部へのこだわり', options: [
    { value: 'good', label: '得意' }, { value: 'weak', label: '苦手' }, { value: 'neutral', label: 'どちらでもない' },
  ]},
];

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
        {selectFields.map((f) => (
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
