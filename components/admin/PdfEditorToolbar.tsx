'use client';

/**
 * PDF エディタ サイドバー
 * カテゴリ別チェックボックス一覧で社員/カスタム/テナント/固定値フィールドを複数選択して一括タグ追加
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import type { PdfTag, PdfTagPlacement } from '@/lib/types';
import { FONT_SIZES } from '@/lib/constants';
import {
  employeeFields,
  tenantFields,
  fixedFields,
  sourceTypeLabels,
  type FieldOption,
} from '@/lib/pdf-fields';

interface Props {
  tags: PdfTag[];
  placements: PdfTagPlacement[];
  selectedPlacement: PdfTagPlacement | null;
  onFontSizeChange: (placementId: string, fontSize: number) => void;
  onDeletePlacement: (placementId: string) => void;
  onAddTags: (items: { displayName: string; columnKey?: string }[]) => void;
  onDeleteTag: (tagId: string) => void;
  onPreview?: () => void;
  previewLoading?: boolean;
}

const sourceTypes = ['employee', 'custom_field', 'tenant', 'fixed'] as const;

export default function PdfEditorToolbar({
  tags,
  placements,
  selectedPlacement,
  onFontSizeChange,
  onDeletePlacement,
  onAddTags,
  onDeleteTag,
  onPreview,
  previewLoading,
}: Props) {
  //フィールド選択用（複数選択対応）
  const [selectedSource, setSelectedSource] = useState<string>('employee');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [customFieldOptions, setCustomFieldOptions] = useState<FieldOption[]>([]);

  useEffect(() => {
    async function loadCustomFields() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;
      const { data: cfs } = await supabase.from('custom_employee_fields').select('field_key, label').eq('tenant_id', me.tenant_id).eq('is_active', true).order('display_order');
      if (cfs) setCustomFieldOptions(cfs.map((f: { field_key: string; label: string }) => ({ value: f.field_key, label: f.label })));
    }
    loadCustomFields();
  }, []);

  // 現在選択中のソースに応じたフィールドリスト
  const currentFieldList = selectedSource === 'employee' ? employeeFields
    : selectedSource === 'custom_field' ? customFieldOptions
    : selectedSource === 'tenant' ? tenantFields
    : fixedFields;

  // 既に追加済みのcolumn_keyを除外
  const availableFields = currentFieldList.filter(
    (f) => !tags.some((t) => t.column_key === `${selectedSource}.${f.value}`)
  );

  function toggleField(value: string, checked: boolean) {
    setSelectedFields((prev) => checked ? [...prev, value] : prev.filter((v) => v !== value));
  }

  function selectAllAvailable() {
    setSelectedFields(availableFields.map((f) => f.value));
  }

  function clearSelection() {
    setSelectedFields([]);
  }

  function handleAddSelected() {
    if (selectedFields.length === 0) return;

    const items = selectedFields.map((fieldValue) => {
      const field = currentFieldList.find((f) => f.value === fieldValue);
      return {
        displayName: field?.label || fieldValue,
        columnKey: `${selectedSource}.${fieldValue}`,
      };
    });

    onAddTags(items);
    setSelectedFields([]);
  }

  return (
    <div className="w-64 border-l border-brand-gray/10 bg-white flex flex-col h-full overflow-hidden">
      {/* タグ一覧 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <h3 className="text-[10px] font-bold text-brand-gray uppercase tracking-wider">
          タグ一覧
        </h3>
        <p className="text-[11px] text-brand-gray-light leading-relaxed">
          タグをドラッグしてPDF上に配置できます
        </p>

        <div className="space-y-1">
          {tags.map((tag) => {
            const placed = placements.some((p) => p.tag_id === tag.id);
            return (
              <div
                key={tag.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('tagId', tag.id);
                }}
                className={`
                  group flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm cursor-grab active:cursor-grabbing transition-all
                  ${placed
                    ? 'border-brand-blue/30 bg-brand-blue/5 text-brand-blue'
                    : 'border-brand-gray/20 bg-white text-brand-ink hover:border-brand-blue/30'}
                `}
              >
                <span className="truncate" style={{ fontFamily: 'IPAex Mincho, MS Mincho, serif' }}>|__{tag.display_name}__</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTag(tag.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-brand-red hover:text-brand-red/80 transition-opacity ml-1"
                  title="タグを削除"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* タグ追加UI — チェックボックス複数選択で一括追加 */}
          <div className="space-y-2 pt-2 border-t border-brand-gray/10">
            <label className="block text-[10px] font-bold text-brand-gray uppercase tracking-wider">
              フィールド追加（複数選択可）
            </label>
            {/* ソース種別選択 — 切替時に選択状態をリセット */}
            <select
              value={selectedSource}
              onChange={(e) => {
                setSelectedSource(e.target.value);
                setSelectedFields([]);
              }}
              className="flex h-8 w-full rounded-md border border-brand-gray/20 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
            >
              {sourceTypes.map((s) => (
                <option key={s} value={s}>{sourceTypeLabels[s]}</option>
              ))}
            </select>

            {/* 全選択 / 解除 */}
            {availableFields.length > 0 && (
              <div className="flex items-center justify-between text-[10px] text-brand-gray">
                <span>
                  {selectedFields.length > 0 ? `${selectedFields.length} 件選択中` : `${availableFields.length} 件`}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllAvailable}
                    className="text-brand-blue hover:text-brand-ink underline"
                  >
                    すべて選択
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={selectedFields.length === 0}
                    className="text-brand-gray hover:text-brand-ink underline disabled:opacity-30 disabled:no-underline"
                  >
                    解除
                  </button>
                </div>
              </div>
            )}

            {/* チェックボックス一覧 */}
            <div className="border border-brand-gray/20 rounded-md max-h-64 overflow-y-auto bg-white">
              {availableFields.length === 0 ? (
                <p className="px-2 py-3 text-[10px] text-brand-gray-light text-center">
                  {currentFieldList.length === 0
                    ? 'フィールドがありません'
                    : 'このカテゴリのフィールドは全て追加済みです'}
                </p>
              ) : (
                availableFields.map((f) => (
                  <label
                    key={f.value}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-brand-bg border-b border-brand-gray/5 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.includes(f.value)}
                      onChange={(e) => toggleField(f.value, e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-brand-blue shrink-0"
                    />
                    <span className="truncate">{f.label}</span>
                  </label>
                ))
              )}
            </div>

            <Button
              size="sm"
              onClick={handleAddSelected}
              disabled={selectedFields.length === 0}
              className="w-full h-8 text-xs"
            >
              {selectedFields.length === 0
                ? '+ タグを追加'
                : `+ 選択した ${selectedFields.length} 件を追加`}
            </Button>
          </div>

      </div>

      {/* 選択中の配置の書式設定 */}
      <div className="border-t border-brand-gray/10 p-4 space-y-3 shrink-0">
        <h3 className="text-[10px] font-bold text-brand-gray uppercase tracking-wider">
          書式設定
        </h3>

        {selectedPlacement ? (
          <>
            <div>
              <label className="block text-xs font-medium text-brand-ink mb-1">フォントサイズ</label>
              <select
                value={selectedPlacement.font_size}
                onChange={(e) => onFontSizeChange(selectedPlacement.id, Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-brand-gray/20 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              >
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>{s}pt</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => onDeletePlacement(selectedPlacement.id)}
              className="w-full h-9 rounded-md text-sm font-medium text-brand-red bg-brand-red/10 border border-transparent hover:border-brand-red/30 transition-all"
            >
              この配置を削除
            </button>
          </>
        ) : (
          <p className="text-xs text-brand-gray-light leading-relaxed">
            タグを選択すると<br />サイズ設定ができます
          </p>
        )}

        {onPreview && (
          <div className="pt-3 border-t border-brand-gray/10">
            <Button
              size="sm"
              variant="outline"
              onClick={onPreview}
              disabled={previewLoading}
              className="w-full h-9 text-xs"
            >
              {previewLoading ? 'プレビュー生成中...' : '📋 サンプルプレビュー'}
            </Button>
            <p className="text-[10px] text-brand-gray-light mt-1">
              実際のデータが入った状態を確認
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
