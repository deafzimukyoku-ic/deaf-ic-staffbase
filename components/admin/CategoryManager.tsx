'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CATEGORY_COLOR_PRESETS,
  CATEGORY_ICON_SUGGESTIONS,
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
} from '@/lib/category-presets';
import { createClient } from '@/lib/supabase/client';
import { CategoryImportModal } from './CategoryImportModal';
import { FacilityScopeSelector, TargetScopeBadge } from './FacilityScopeSelector';
import type { Category, CategoryType, Facility, TargetType } from '@/lib/types';

// CategoryType → 対応するコンテンツテーブル名
const CONTENT_TABLE: Record<CategoryType, string> = {
  compliance: 'compliance_documents',
  training: 'trainings',
  announcement: 'announcements',
  manual: 'manuals',
};

interface Props {
  type: CategoryType;
  /**
   * カテゴリの作成・更新・削除・並び替えが成功したあとに親に通知するコールバック。
   * モーダルから起動する親ページがカテゴリ列・フィルタを軽量に再取得するために使う。
   * （CategoryImportModal の onImported と同じパターン）
   */
  onChanged?: () => void | Promise<void>;
}

export function CategoryManager({ type, onChanged }: Props) {
  const [items, setItems] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const supabase = createClient();

  /* 225: tenant / role / facility audience 用の context */
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>('employee');
  const [facilities, setFacilities] = useState<Facility[]>([]);

  // 追加フォーム
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_CATEGORY_COLOR);
  const [newIcon, setNewIcon] = useState(DEFAULT_CATEGORY_ICON);
  const [newTargetType, setNewTargetType] = useState<TargetType>('all');
  const [newTargetFacilityIds, setNewTargetFacilityIds] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  async function load() {
    setLoading(true);
    setErrorMsg(null);
    const res = await fetch(`/api/categories?type=${type}`);
    if (!res.ok) {
      setErrorMsg('カテゴリの取得に失敗しました');
      setLoading(false);
      return;
    }
    const data: Category[] = await res.json();
    setItems(data);

    // カテゴリ別のアイテム数も取得（RLS で tenant 内のみ）
    const table = CONTENT_TABLE[type];
    const { data: rows } = await supabase
      .from(table)
      .select('category_id');
    const c: Record<string, number> = {};
    let uncat = 0;
    for (const r of (rows ?? []) as Array<{ category_id: string | null }>) {
      if (r.category_id) c[r.category_id] = (c[r.category_id] ?? 0) + 1;
      else uncat++;
    }
    setCounts(c);
    setUncategorizedCount(uncat);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  /* 225: tenant_id / role / facilities を取得（FacilityScopeSelector / TargetScopeBadge 用） */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase
        .from('employees')
        .select('tenant_id, role')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!me) return;
      setTenantId(me.tenant_id as string);
      setMyRole((me.role as string) ?? 'employee');
      /* manager の場合は新規作成時に target_type='facility' をデフォルトに */
      if (me.role === 'manager') setNewTargetType('facility');

      const { data: facs } = await supabase
        .from('facilities')
        .select('id, name')
        .eq('tenant_id', me.tenant_id)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });
      setFacilities((facs as Facility[]) ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!newName.trim()) {
      setErrorMsg('カテゴリ名を入力してください');
      return;
    }
    /* 225: facility audience バリデーション */
    if (newTargetType === 'facility' && newTargetFacilityIds.length === 0) {
      setErrorMsg('配信対象の施設を1つ以上選択してください');
      return;
    }
    if (myRole === 'manager' && newTargetType === 'all') {
      setErrorMsg('マネージャーは「全社共通」カテゴリを作成できません');
      return;
    }
    setCreating(true);
    setErrorMsg(null);
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        name: newName.trim(),
        color: newColor,
        icon: newIcon || DEFAULT_CATEGORY_ICON,
        target_type: newTargetType,
        target_facility_ids: newTargetType === 'facility' ? newTargetFacilityIds : [],
      }),
    });
    setCreating(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErrorMsg(err.error || '作成に失敗しました');
      return;
    }
    setNewName('');
    setNewColor(DEFAULT_CATEGORY_COLOR);
    setNewIcon(DEFAULT_CATEGORY_ICON);
    /* manager は 'facility' 固定、admin は 'all' に戻す */
    setNewTargetType(myRole === 'manager' ? 'facility' : 'all');
    setNewTargetFacilityIds([]);
    await load();
    await onChanged?.();
  }

  async function handleUpdate(id: string, patch: Partial<Pick<Category, 'name' | 'color' | 'icon' | 'target_type' | 'target_facility_ids'>>) {
    setErrorMsg(null);
    const res = await fetch(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErrorMsg(err.error || '更新に失敗しました');
      return false;
    }
    await load();
    await onChanged?.();
    return true;
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`カテゴリ「${name}」を削除しますか？`)) return;
    setErrorMsg(null);
    const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErrorMsg(err.error || '削除に失敗しました');
      return;
    }
    await load();
    await onChanged?.();
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(i => i.id === active.id);
    const newIndex = items.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    // 楽観更新
    setItems(reordered);

    const orders = reordered.map((c, idx) => ({ id: c.id, sort_order: idx }));
    const res = await fetch('/api/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders }),
    });
    if (!res.ok) {
      setErrorMsg('並び替えの保存に失敗しました');
      await load(); // 失敗時はサーバー状態に戻す
      return;
    }
    await onChanged?.();
  }

  return (
    <div className="space-y-4">
      {/* 役割の説明ポップ相当 */}
      <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3.5 space-y-2 mb-2">
        <div className="flex items-center gap-2 text-blue-700">
          <span className="text-sm">ℹ️</span>
          <span className="text-xs font-bold font-inter tracking-wider">カテゴリ設定のヒント</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px] text-blue-600/80 leading-relaxed font-inter">
          <div>
            <p className="font-bold mb-0.5 text-blue-700">1. マーク（アイコン）の役割</p>
            <p>内容の「種類」を伝えます。📢は通知、📚は研修など、一目で情報の性質を判断する助けになります。</p>
          </div>
          <div>
            <p className="font-bold mb-0.5 text-blue-700">2. 色（カラーバッジ）の役割</p>
            <p>情報の「重要度」や「分類」を強調します。赤は緊急、青は一般など、視認性と優先順位を高めます。</p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* 新規作成フォーム */}
      <div className="rounded-lg border border-brand-gray/15 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-semibold text-brand-ink">新しいカテゴリを追加</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            className="text-xs"
          >
            📥 他の分類から取り込む
          </Button>
        </div>
        {/* ラベル + 入力欄の高さを揃えるため、ヒント文はフォーム外に出す */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[100px] space-y-1">
            <label className="text-[11px] text-brand-gray-light block h-[14px]">アイコン</label>
            <Input
              value={newIcon}
              onChange={(e) => setNewIcon(e.target.value)}
              placeholder="📁"
              maxLength={4}
              className="text-center text-lg h-10"
            />
          </div>
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="text-[11px] text-brand-gray-light block h-[14px]">カテゴリ名</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例: 安全衛生"
              maxLength={30}
              className="h-10"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-brand-gray-light block h-[14px]">色</label>
            <div className="h-10 flex items-center">
              <ColorPicker value={newColor} onChange={setNewColor} />
            </div>
          </div>
          <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="h-10">
            {creating ? '追加中...' : '追加'}
          </Button>
        </div>
        {/* 225: 配信対象 (facility audience) */}
        <FacilityScopeSelector
          tenantId={tenantId}
          targetType={newTargetType}
          targetFacilityIds={newTargetFacilityIds}
          onChange={(next) => {
            /* manager は 'all' に変更不可 */
            if (myRole === 'manager' && next.target_type === 'all') return;
            setNewTargetType(next.target_type);
            setNewTargetFacilityIds(next.target_facility_ids);
          }}
          label="このカテゴリの配信対象"
        />
        <p className="text-[10px] text-brand-gray-light">
          💡 絵文字入力: Win <kbd className="bg-gray-100 px-1 rounded">⊞ + .</kbd> / Mac <kbd className="bg-gray-100 px-1 rounded">⌘⌃Space</kbd>
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="text-[11px] text-brand-gray-light mr-1 self-center">絵文字候補:</span>
          {CATEGORY_ICON_SUGGESTIONS.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setNewIcon(e)}
              className="text-base hover:scale-125 transition-transform"
              title={e}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* 一覧（D&D並び替え） */}
      <div className="rounded-lg border border-brand-gray/15 bg-white">
        <div className="border-b border-brand-gray/10 px-4 py-2 text-xs text-brand-gray-light">
          ドラッグ&amp;ドロップで並び替えできます
        </div>
        {loading ? (
          <p className="p-4 text-sm text-brand-gray-light">読み込み中...</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-brand-gray-light">カテゴリがありません。上から追加してください。</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y divide-brand-gray/10">
                {items.map(cat => (
                  <SortableRow
                    key={cat.id}
                    category={cat}
                    itemCount={counts[cat.id] ?? 0}
                    editing={editingId === cat.id}
                    onStartEdit={() => setEditingId(cat.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSave={async (patch) => {
                      const ok = await handleUpdate(cat.id, patch);
                      if (ok) setEditingId(null);
                    }}
                    onDelete={() => handleDelete(cat.id, cat.name)}
                    tenantId={tenantId}
                    facilities={facilities}
                    myRole={myRole}
                  />
                ))}
              </ul>
              {uncategorizedCount > 0 && (
                <div className="border-t border-brand-gray/10 px-4 py-2.5 bg-brand-beige/30 text-xs text-brand-gray flex items-center gap-2">
                  <span className="text-brand-gray-light">📁</span>
                  <span>カテゴリ未設定</span>
                  <span className="ml-auto font-bold text-brand-ink tabular-nums">{uncategorizedCount} 項目</span>
                </div>
              )}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* 取り込みモーダル */}
      <CategoryImportModal
        destinationType={type}
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          await load();
          await onChanged?.();
        }}
      />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {CATEGORY_COLOR_PRESETS.map(c => (
        <button
          key={c.hex}
          type="button"
          onClick={() => onChange(c.hex)}
          title={c.label}
          className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${value === c.hex ? 'border-brand-ink scale-110' : 'border-white'
            }`}
          style={{ backgroundColor: c.hex }}
          aria-label={c.label}
        />
      ))}
    </div>
  );
}

interface RowProps {
  category: Category;
  itemCount: number;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { name?: string; color?: string; icon?: string; target_type?: TargetType; target_facility_ids?: string[] }) => void | Promise<void>;
  onDelete: () => void;
  /* 225: audience 編集 + バッジ表示用 */
  tenantId: string | null;
  facilities: Facility[];
  myRole: string;
}

function SortableRow({ category, itemCount, editing, onStartEdit, onCancelEdit, onSave, onDelete, tenantId, facilities, myRole }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [icon, setIcon] = useState(category.icon);
  /* 225: audience 編集 state */
  const [targetType, setTargetType] = useState<TargetType>((category.target_type ?? 'all') as TargetType);
  const [targetFacilityIds, setTargetFacilityIds] = useState<string[]>(category.target_facility_ids ?? []);

  useEffect(() => {
    if (editing) {
      setName(category.name);
      setColor(category.color);
      setIcon(category.icon);
      setTargetType((category.target_type ?? 'all') as TargetType);
      setTargetFacilityIds(category.target_facility_ids ?? []);
    }
  }, [editing, category]);

  if (editing) {
    return (
      <li ref={setNodeRef} style={style} className="p-3 bg-brand-beige/40 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} className="w-16 text-center text-lg" />
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} className="flex-1 min-w-[160px]" />
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <FacilityScopeSelector
          tenantId={tenantId}
          targetType={targetType}
          targetFacilityIds={targetFacilityIds}
          onChange={(next) => {
            if (myRole === 'manager' && next.target_type === 'all') return;
            setTargetType(next.target_type);
            setTargetFacilityIds(next.target_facility_ids);
          }}
          label="このカテゴリの配信対象"
        />
        <div className="flex gap-1 justify-end">
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>キャンセル</Button>
          <Button
            size="sm"
            onClick={() => onSave({
              name: name.trim(),
              color,
              icon: icon || '📁',
              target_type: targetType,
              target_facility_ids: targetType === 'facility' ? targetFacilityIds : [],
            })}
          >
            保存
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 p-3 hover:bg-brand-beige/30">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing px-1 text-brand-gray-light hover:text-brand-ink"
        title="ドラッグで並び替え"
        aria-label="並び替え"
      >
        ⋮⋮
      </button>
      <span className="text-xl w-8 text-center">{category.icon}</span>
      <span
        className="inline-block h-3 w-3 rounded-full shrink-0"
        style={{ backgroundColor: category.color }}
      />
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-brand-ink">{category.name}</span>
        {/* 225: audience バッジ */}
        <TargetScopeBadge
          targetType={(category.target_type ?? 'all') as TargetType}
          targetFacilityIds={category.target_facility_ids ?? []}
          facilities={facilities}
        />
      </div>
      <span className="text-xs text-brand-gray-light tabular-nums shrink-0 mr-2">
        {itemCount} 項目
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={onStartEdit}>編集</Button>
        <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={onDelete}>
          削除
        </Button>
      </div>
    </li>
  );
}
