'use client';

import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Employee } from '@/lib/types';

type IntroFields = Pick<Employee,
  'self_introduction' | 'current_duties' | 'past_duties' | 'qualifications' |
  'efforts_focused_on' | 'how_others_describe' | 'values_and_motivation'
>;

interface Props {
  data: IntroFields;
  onChange: (data: IntroFields) => void;
}

const fields: { key: keyof IntroFields; label: string; placeholder: string }[] = [
  { key: 'self_introduction', label: '自己紹介', placeholder: '簡単な自己紹介をお書きください' },
  { key: 'current_duties', label: '現在の主な担当業務', placeholder: '現在担当している業務内容' },
  { key: 'past_duties', label: '過去に担当した業務', placeholder: '以前担当していた業務' },
  { key: 'qualifications', label: '保有資格・得意分野', placeholder: '資格やスキル' },
  { key: 'efforts_focused_on', label: '力を入れてきたこと', placeholder: 'これまで注力してきたこと' },
  { key: 'how_others_describe', label: '周囲からどのような人だと言われるか', placeholder: '周りの人からの評価' },
  { key: 'values_and_motivation', label: '仕事をするうえで大切にしていること', placeholder: '仕事への価値観' },
];

export function ProfileSection2Intro({ data, onChange }: Props) {
  function update(key: keyof IntroFields, value: string) {
    onChange({ ...data, [key]: value || null });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>自己紹介・業務経歴</CardTitle>
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
              rows={3}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
