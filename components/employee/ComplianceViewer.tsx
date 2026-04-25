'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  content: string;
  comment: string | null;
  acknowledged: boolean;
  onAcknowledge: () => void;
  loading: boolean;
}

export function ComplianceViewer({ content, comment, acknowledged, onAcknowledge, loading }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">遵守事項</CardTitle>
          {acknowledged && (
            <Badge className="bg-diletto-green/10 text-diletto-green">確認済</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="whitespace-pre-wrap text-sm leading-relaxed border rounded-md p-4 bg-white">
          {content}
        </div>

        {comment && (
          <div className="text-sm text-diletto-gray border-l-2 border-diletto-blue pl-3">
            {comment}
          </div>
        )}

        {!acknowledged && (
          <Button onClick={onAcknowledge} disabled={loading} className="w-full">
            {loading ? '処理中...' : '確認しました'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
