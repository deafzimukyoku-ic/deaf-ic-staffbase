'use client';

/**
 * PDF エディタ サイドバー
 * カテゴリ別ドロップダウンで社員/カスタム/テナント/固定値フィールドを選択してタグ追加
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  onAddTag: (displayName: string, columnKey?: string) => void;
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
  onAddTag,
  onDeleteTag,
  onPreview,
  previewLoading,
}: Props) {
  //フィールド選択用
  const [selectedSource, setSelectedSource] = useState<string>('employee');
  const [selectedField, setSelectedField] = useState<string>('');
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

  function handleAddTagEmployee() {
    if (!selectedField) return;

    const columnKey = `${selectedSource}.${selectedField}`;

    // 既に追加済みか確認
    if (tags.some((t) => t.column_key === columnKey)) {
      return;
    }

    // 日本語ラベルを取得
    const fieldList = selectedSource === 'employee' ? employeeFields
      : selectedSource === 'custom_field' ? customFieldOptions
      : selectedSource === 'tenant' ? tenantFields
      : fixedFields;
    const field = fieldList.find((f) => f.value === selectedField);
    const displayName = field?.label || selectedField;

    onAddTag(displayName, columnKey);
    setSelectedField('');
  }

  // 現在選択中のソースに応じたフィールドリスト
  const currentFieldList = selectedSource === 'employee' ? employeeFields
    : selectedSource === 'custom_field' ? customFieldOptions
    : selectedSource === 'tenant' ? tenantFields
    : fixedFields;

  // 既に追加済みのcolumn_keyを除外
  const availableFields = currentFieldList.filter(
    (f) => !tags.some((t) => t.column_key === `${selectedSource}.${f.value}`)
  );

  return (
    <div className="w-64 border-l border-diletto-gray/10 bg-white flex flex-col h-full overflow-hidden">
      {/* タグ一覧 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <h3 className="text-[10px] font-bold text-diletto-gray uppercase tracking-wider">
          タグ一覧
        </h3>
        <p className="text-[11px] text-diletto-gray-light leading-relaxed">
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
                    ? 'border-diletto-blue/30 bg-diletto-blue/5 text-diletto-blue'
                    : 'border-diletto-gray/20 bg-white text-diletto-ink hover:border-diletto-blue/30'}
                `}
              >
                <span className="truncate" style={{ fontFamily: 'IPAex Mincho, MS Mincho, serif' }}>|__{tag.display_name}__</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTag(tag.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-diletto-red hover:text-diletto-red/80 transition-opacity ml-1"
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

        {/* タグ追加UI — フィールド選択（全モード共通） */}
          <div className="space-y-2 pt-2 border-t border-diletto-gray/10">
            <label className="block text-[10px] font-bold text-diletto-gray uppercase tracking-wider">
              フィールド追加
            </label>
            {/* ソース種別選択 */}
            <select
              value={selectedSource}
              onChange={(e) => {
                setSelectedSource(e.target.value);
                setSelectedField('');
              }}
              className="flex h-8 w-full rounded-md border border-diletto-gray/20 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-diletto-blue/40"
            >
              {sourceTypes.map((s) => (
                <option key={s} value={s}>{sourceTypeLabels[s]}</option>
              ))}
            </select>

            {/* フィールド選択 */}
            <select
              value={selectedField}
              onChange={(e) => setSelectedField(e.target.value)}
              className="flex h-8 w-full rounded-md border border-diletto-gray/20 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-diletto-blue/40"
            >
              <option value="">フィールドを選択...</option>
              {availableFields.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            <Button
              size="sm"
              onClick={handleAddTagEmployee}
              disabled={!selectedField}
              className="w-full h-8 text-xs"
            >
              + タグを追加
            </Button>

            {availableFields.length === 0 && currentFieldList.length > 0 && (
              <p className="text-[10px] text-diletto-gray-light">
                このカテゴリのフィールドは全て追加済みです
              </p>
            )}
          </div>

      </div>

      {/* 選択中の配置の書式設定 */}
      <div className="border-t border-diletto-gray/10 p-4 space-y-3 shrink-0">
        <h3 className="text-[10px] font-bold text-diletto-gray uppercase tracking-wider">
          書式設定
        </h3>

        {selectedPlacement ? (
          <>
            <div>
              <label className="block text-xs font-medium text-diletto-ink mb-1">フォントサイズ</label>
              <select
                value={selectedPlacement.font_size}
                onChange={(e) => onFontSizeChange(selectedPlacement.id, Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-diletto-gray/20 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-diletto-blue/40"
              >
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>{s}pt</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => onDeletePlacement(selectedPlacement.id)}
              className="w-full h-9 rounded-md text-sm font-medium text-diletto-red bg-diletto-red/10 border border-transparent hover:border-diletto-red/30 transition-all"
            >
              この配置を削除
            </button>
          </>
        ) : (
          <p className="text-xs text-diletto-gray-light leading-relaxed">
            タグを選択すると<br />サイズ設定ができます
          </p>
        )}

        {onPreview && (
          <div className="pt-3 border-t border-diletto-gray/10">
            <Button
              size="sm"
              variant="outline"
              onClick={onPreview}
              disabled={previewLoading}
              className="w-full h-9 text-xs"
            >
              {previewLoading ? 'プレビュー生成中...' : '📋 サンプルプレビュー'}
            </Button>
            <p className="text-[10px] text-diletto-gray-light mt-1">
              実際のデータが入った状態を確認
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
