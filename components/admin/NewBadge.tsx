// 直近7日以内に作成されたアイテムに NEW バッジを表示
// created_at が無い場合は updated_at を許容（compliance_documents 向け）

const NEW_THRESHOLD_DAYS = 7;

export function isNew(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const diffMs = Date.now() - created;
  return diffMs < NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

export function NewBadge({ createdAt }: { createdAt: string | null | undefined }) {
  if (!isNew(createdAt)) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-sm">
      <span>✦</span>
      <span>NEW</span>
    </span>
  );
}
