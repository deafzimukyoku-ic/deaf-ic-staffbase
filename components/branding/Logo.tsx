// 認定NPO法人名古屋ろう国際センター ロゴ
// /public/logo.jpg を参照。サイズはバリアントで選択

interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'h-7',
  md: 'h-10',
  lg: 'h-14',
} as const;

export function Logo({ size = 'md', className = '' }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.jpg"
      alt="認定NPO法人名古屋ろう国際センター"
      className={`${SIZES[size]} w-auto object-contain ${className}`}
    />
  );
}
