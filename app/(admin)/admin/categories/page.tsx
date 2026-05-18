'use client';

import { useState } from 'react';
import { CategoryManager } from '@/components/admin/CategoryManager';
import type { CategoryType } from '@/lib/types';

const TABS: { key: CategoryType; label: string; icon: string }[] = [
  { key: 'compliance', label: '遵守事項', icon: '✅' },
  { key: 'training', label: '研修', icon: '📚' },
  { key: 'announcement', label: 'お知らせ', icon: '📢' },
  { key: 'manual', label: '業務マニュアル', icon: '📖' },
];

export default function AdminCategoriesPage() {
  const [activeTab, setActiveTab] = useState<CategoryType>('compliance');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">カテゴリ管理</h1>
        <p className="text-sm text-brand-gray-light mt-1">
          遵守事項・研修・お知らせ・業務マニュアルに分類を設定します。分類ごとに名前・色・アイコン（絵文字）を自由に設定できます。
        </p>
      </div>

      {/* タブ */}
      <div className="flex gap-1 border-b border-brand-gray/15">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-brand-ink text-brand-ink'
                : 'border-transparent text-brand-gray-light hover:text-brand-ink'
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <CategoryManager key={activeTab} type={activeTab} />
    </div>
  );
}
