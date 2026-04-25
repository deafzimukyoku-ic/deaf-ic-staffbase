import { Card, CardContent } from '@/components/ui/card';

interface Props {
  title: string;
  icon: string;
  description?: string;
  phase?: string;
}

// Phase 4〜7 で実装予定のページ共通プレースホルダ。
// サイドバー導線だけ先に整える段階のため、UI だけ表示して機能は空。
export function PlaceholderPage({ title, icon, description, phase }: Props) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <span className="text-3xl">{icon}</span>
        <h1 className="text-2xl font-bold text-diletto-ink">{title}</h1>
      </div>
      <Card className="border-dashed border-2 border-diletto-gray/20 bg-transparent rounded-md">
        <CardContent className="py-16 text-center">
          <div className="text-6xl mb-4 opacity-30">🚧</div>
          <p className="text-lg font-bold text-diletto-ink mb-2">準備中</p>
          {description && (
            <p className="text-sm text-diletto-gray max-w-md mx-auto mb-4">{description}</p>
          )}
          {phase && (
            <p className="text-xs text-diletto-gray-light">実装フェーズ: {phase}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
