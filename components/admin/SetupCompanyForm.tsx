'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Tenant } from '@/lib/types';

interface Props {
  data: Pick<Tenant, 'company_name' | 'representative_title' | 'representative_name' | 'representative_honorific'>;
  onChange: (data: Props['data']) => void;
  onNext: () => void;
}

export function SetupCompanyForm({ data, onChange, onNext }: Props) {
  function update(field: keyof Props['data'], value: string) {
    onChange({ ...data, [field]: value });
  }

  const canProceed =
    data.company_name.trim() &&
    data.representative_title.trim() &&
    data.representative_name.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle>会社情報</CardTitle>
        <CardDescription>会社名・代表者情報を入力してください</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="company_name">会社名・法人名 *</Label>
          <Input
            id="company_name"
            value={data.company_name}
            onChange={(e) => update('company_name', e.target.value)}
            placeholder="株式会社〇〇"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="rep_title">代表者肩書 *</Label>
            <Input
              id="rep_title"
              value={data.representative_title}
              onChange={(e) => update('representative_title', e.target.value)}
              placeholder="代表取締役"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rep_name">代表者氏名 *</Label>
            <Input
              id="rep_name"
              value={data.representative_name}
              onChange={(e) => update('representative_name', e.target.value)}
              placeholder="山田 太郎"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rep_honorific">代表者敬称</Label>
          <Input
            id="rep_honorific"
            value={data.representative_honorific}
            onChange={(e) => update('representative_honorific', e.target.value)}
            placeholder="様"
          />
        </div>
        <div className="flex justify-end pt-2">
          <Button onClick={onNext} disabled={!canProceed}>
            次へ：給与振込先
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
