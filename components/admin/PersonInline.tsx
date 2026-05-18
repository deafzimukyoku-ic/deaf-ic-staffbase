// 作成者・編集者などの人物表示の共通フォーマット
// 名前が空の場合は full_name → email → 「不明」とフォールバックする

interface Person {
  last_name?: string | null;
  first_name?: string | null;
  email?: string | null;
}

export function personLabel(p: Person | null | undefined): string {
  if (!p) return '';
  const ln = (p.last_name ?? '').trim();
  const fn = (p.first_name ?? '').trim();
  const combined = `${ln} ${fn}`.trim();
  if (combined) return combined;
  if (p.email && p.email.trim()) return p.email.trim();
  return '不明';
}

interface InlineProps {
  /** "作成者" や "編集者" などのラベル */
  label: string;
  person: Person | null | undefined;
}

export function PersonInline({ label, person }: InlineProps) {
  if (!person) return null;
  return (
    <span className="text-[10px] text-brand-gray-light font-medium tracking-tighter">
      {label}: {personLabel(person)}
    </span>
  );
}
