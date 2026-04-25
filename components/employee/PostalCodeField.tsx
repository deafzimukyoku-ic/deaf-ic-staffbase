'use client';

import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * 郵便番号入力フィールド + 住所自動補完
 *
 * - 郵便番号入力（7桁）後、自動的に zipcloud (https://zipcloud.ibsnet.co.jp) に問い合わせ
 * - ヒットすれば onAddressFound に都道府県+市区町村+町域 を渡す
 * - ハイフンの有無どちらでも受け付け、保存時には "XXX-XXXX" に正規化
 *
 * zipcloud は無料・登録不要で CORS 許可されている公開 API。
 */

interface Props {
  label?: string;
  value: string;
  onChange: (postalCode: string) => void;
  /** 住所がヒットしたとき呼ばれる。手入力済みの住所を上書きしないため、空文字または既存値を別管理しているケースは呼び出し側で制御 */
  onAddressFound?: (address: string) => void;
  placeholder?: string;
  /** 既存の住所フィールド値。空欄のときだけ自動上書き、入力済みのときは確認ダイアログ */
  currentAddress?: string;
  required?: boolean;
}

function normalize(raw: string): { digits7: string; formatted: string } {
  const digits = (raw ?? '').replace(/\D/g, '').slice(0, 7);
  const formatted = digits.length === 7 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : raw;
  return { digits7: digits, formatted };
}

export function PostalCodeField({
  label = '郵便番号',
  value,
  onChange,
  onAddressFound,
  placeholder = '000-0000',
  currentAddress,
  required,
}: Props) {
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLookupRef = useRef<string>('');

  async function lookup(digits7: string) {
    if (lastLookupRef.current === digits7) return; // 重複リクエスト防止
    lastLookupRef.current = digits7;
    setLooking(true);
    setError(null);
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits7}`);
      if (!res.ok) throw new Error('住所検索に失敗しました');
      const json = await res.json() as {
        status: number;
        message: string | null;
        results: Array<{ address1: string; address2: string; address3: string }> | null;
      };
      if (json.status !== 200) {
        setError(json.message || '住所検索に失敗しました');
        return;
      }
      const r = json.results?.[0];
      if (!r) {
        setError('該当する住所が見つかりません');
        return;
      }
      const found = `${r.address1}${r.address2}${r.address3}`;
      if (onAddressFound) {
        // 既存住所の上書き判定: 既に入力されていて、補完候補と異なる場合のみ確認
        if (currentAddress && currentAddress.trim() && currentAddress.trim() !== found) {
          if (!confirm(`既存の住所「${currentAddress}」を\n「${found}」で上書きしますか？`)) {
            return;
          }
        }
        onAddressFound(found);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '住所検索に失敗しました');
    } finally {
      setLooking(false);
    }
  }

  function handleChange(raw: string) {
    const { digits7, formatted } = normalize(raw);
    onChange(formatted);
    if (digits7.length === 7) {
      void lookup(digits7);
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}{required && ' *'}</Label>
      <div className="flex gap-2 items-center">
        <Input
          value={value || ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
          maxLength={8}
        />
        {looking && <span className="text-xs text-diletto-gray">検索中...</span>}
      </div>
      {error && <p className="text-xs text-diletto-red">{error}</p>}
    </div>
  );
}
