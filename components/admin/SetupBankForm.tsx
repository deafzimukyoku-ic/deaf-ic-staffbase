'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MAX_PAYROLL_BANKS_PER_TENANT } from '@/lib/constants';

interface BankEntry {
  bank_name: string;
  is_default: boolean;
}

interface Props {
  banks: BankEntry[];
  onChange: (banks: BankEntry[]) => void;
  onNext: () => void;
  onBack: () => void;
}

export function SetupBankForm({ banks, onChange, onNext, onBack }: Props) {
  function addBank() {
    if (banks.length >= MAX_PAYROLL_BANKS_PER_TENANT) return;
    onChange([...banks, { bank_name: '', is_default: banks.length === 0 }]);
  }

  function removeBank(index: number) {
    const next = banks.filter((_, i) => i !== index);
    // デフォルトが消えた場合、先頭をデフォルトに
    if (next.length > 0 && !next.some((b) => b.is_default)) {
      next[0].is_default = true;
    }
    onChange(next);
  }

  function updateName(index: number, name: string) {
    const next = [...banks];
    next[index] = { ...next[index], bank_name: name };
    onChange(next);
  }

  function setDefault(index: number) {
    const next = banks.map((b, i) => ({ ...b, is_default: i === index }));
    onChange(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>給与振込先銀行</CardTitle>
        <CardDescription>
          最大{MAX_PAYROLL_BANKS_PER_TENANT}件まで登録可能です（任意、後から設定画面で追加できます）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {banks.map((bank, i) => (
          <div key={i} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label>銀行名 {i + 1}</Label>
              <Input
                value={bank.bank_name}
                onChange={(e) => updateName(i, e.target.value)}
                placeholder="〇〇銀行"
              />
            </div>
            <Button
              type="button"
              variant={bank.is_default ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDefault(i)}
              className="shrink-0"
            >
              {bank.is_default ? 'デフォルト' : '設定'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeBank(i)}
              className="shrink-0 text-diletto-red"
            >
              削除
            </Button>
          </div>
        ))}

        {banks.length < MAX_PAYROLL_BANKS_PER_TENANT && (
          <Button type="button" variant="outline" onClick={addBank} className="w-full">
            + 銀行を追加
          </Button>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>戻る</Button>
          <Button onClick={onNext}>次へ：会社価値観</Button>
        </div>
      </CardContent>
    </Card>
  );
}
