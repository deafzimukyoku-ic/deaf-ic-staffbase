'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface ValuesData {
  company_philosophy: string;
  action_guidelines: string;
  core_values: string;
  valued_behaviors: string;
  avoided_behaviors: string;
  ideal_culture: string;
}

interface Props {
  data: ValuesData;
  onChange: (data: ValuesData) => void;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
}

const fields: { key: keyof ValuesData; label: string; placeholder: string }[] = [
  { key: 'company_philosophy', label: '企業理念', placeholder: '例: お客様の笑顔を第一に...' },
  { key: 'action_guidelines', label: '行動指針', placeholder: '例: 挑戦を恐れず、常に改善を...' },
  { key: 'core_values', label: '重視する価値観', placeholder: '例: 誠実さ、チームワーク、成長...' },
  { key: 'valued_behaviors', label: '評価したい行動', placeholder: '例: 自発的な提案、周囲への配慮...' },
  { key: 'avoided_behaviors', label: '避けたい行動', placeholder: '例: 責任転嫁、報連相の欠如...' },
  { key: 'ideal_culture', label: '理想の組織文化', placeholder: '例: 風通しの良い、互いを尊重する...' },
];

export function SetupValuesForm({ data, onChange, onSubmit, onBack, loading }: Props) {
  function update(key: keyof ValuesData, value: string) {
    onChange({ ...data, [key]: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>会社価値観</CardTitle>
        <CardDescription>
          AI カルチャーフィット診断に使用されます（すべて任意、後から設定画面で編集できます）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Textarea
              id={f.key}
              value={data[f.key]}
              onChange={(e) => update(f.key, e.target.value)}
              placeholder={f.placeholder}
              rows={2}
            />
          </div>
        ))}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>戻る</Button>
          <Button onClick={onSubmit} disabled={loading}>
            {loading ? '保存中...' : 'セットアップを完了'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
