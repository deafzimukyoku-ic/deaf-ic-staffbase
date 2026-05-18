'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// /admin/compliance/[id] のようなパスを見てパンくずを生成する
// 画面幅に関わらず常時表示

const LABELS: Record<string, { label: string; icon: string }> = {
  // admin
  '/admin/dashboard': { label: 'ダッシュボード', icon: '🏠' },
  '/admin/employees': { label: '社員管理', icon: '👥' },
  '/admin/documents': { label: '書類テンプレ', icon: '📄' },
  '/admin/compliance': { label: '遵守事項', icon: '✅' },
  '/admin/trainings': { label: '研修', icon: '📚' },
  '/admin/announcements': { label: 'お知らせ', icon: '📢' },
  '/admin/manuals': { label: '業務マニュアル', icon: '📖' },
  '/admin/team-diagnosis': { label: 'チーム診断', icon: '🔍' },
  '/admin/settings': { label: '設定', icon: '⚙️' },
  '/admin/categories': { label: 'カテゴリ管理', icon: '🏷️' },
  '/admin/children': { label: '児童管理', icon: '👶' },
  '/admin/shifts': { label: 'シフト表', icon: '🗓️' },
  '/admin/shifts/dashboard': { label: 'シフト・送迎ダッシュボード', icon: '📊' },
  '/admin/shifts/schedule': { label: '利用表', icon: '📅' },
  '/admin/shifts/transport': { label: '送迎表', icon: '🚗' },
  '/admin/shifts/output/daily': { label: '日次出力', icon: '📄' },
  '/admin/shifts/output/daily-report': { label: '業務日報', icon: '📋' },
  '/admin/shifts/output/billing': { label: '利用料金表', icon: '💰' },
  '/admin/shifts/output/weekly-transport': { label: '週次送迎表', icon: '🚌' },
  '/admin/shifts/output/staff-child-overlap': { label: '同席日数', icon: '👥' },
  '/admin/shifts/staff-settings': { label: '職員管理', icon: '👔' },
  '/admin/shifts/facility-settings': { label: '事業所設定', icon: '🗺️' },
  '/admin/shifts/events': { label: 'イベント設定', icon: '🎉' },
  '/admin/requests': { label: '休み希望', icon: '📝' },
  // mgr
  '/mgr/dashboard': { label: 'ダッシュボード', icon: '🏠' },
  '/mgr/subordinates': { label: '部下管理', icon: '👥' },
  '/mgr/compliance': { label: '遵守事項', icon: '✅' },
  '/mgr/trainings': { label: '研修', icon: '📚' },
  '/mgr/announcements': { label: 'お知らせ', icon: '📢' },
  '/mgr/manuals': { label: '業務マニュアル', icon: '📖' },
  '/mgr/children': { label: '児童管理', icon: '👶' },
  '/mgr/shifts': { label: 'シフト表', icon: '🗓️' },
  '/mgr/shifts/dashboard': { label: 'シフト・送迎ダッシュボード', icon: '📊' },
  '/mgr/shifts/schedule': { label: '利用表', icon: '📅' },
  '/mgr/shifts/transport': { label: '送迎表', icon: '🚗' },
  '/mgr/shifts/output/daily': { label: '日次出力', icon: '📄' },
  '/mgr/shifts/output/daily-report': { label: '業務日報', icon: '📋' },
  '/mgr/shifts/output/billing': { label: '利用料金表', icon: '💰' },
  '/mgr/shifts/output/weekly-transport': { label: '週次送迎表', icon: '🚌' },
  '/mgr/shifts/output/staff-child-overlap': { label: '同席日数', icon: '👥' },
  '/mgr/shifts/staff-settings': { label: '職員管理', icon: '👔' },
  '/mgr/shifts/facility-settings': { label: '事業所設定', icon: '🗺️' },
  '/mgr/shifts/events': { label: 'イベント設定', icon: '🎉' },
  '/mgr/requests': { label: '休み希望', icon: '📝' },
  // my
  '/my/dashboard': { label: 'ホーム', icon: '🏠' },
  '/my/profile': { label: '基本情報', icon: '👤' },
  '/my/about': { label: '自己紹介', icon: '📝' },
  '/my/documents': { label: '書類', icon: '📄' },
  '/my/compliance': { label: '遵守事項', icon: '✅' },
  '/my/trainings': { label: '研修', icon: '📚' },
  '/my/announcements': { label: 'お知らせ', icon: '📢' },
  '/my/manuals': { label: '業務マニュアル', icon: '📖' },
  '/my/requests': { label: '休み希望（+シフト）', icon: '📝' },
  /* /my/shifts は撤廃済 (/my/requests?tab=facility-shift へリダイレクト)。breadcrumb 用にはマッピング無し */
};

// /admin, /mgr, /my のロール直下パスは実ページが無いためダッシュボードにリダイレクト扱い。
// シフト・送迎モード配下では shift dashboard を、それ以外では通常 dashboard を起点にする。
function getRoleRootRedirect(role: string, pathname: string): string | null {
  if (role === '/admin') {
    if (
      pathname.startsWith('/admin/shifts') ||
      pathname.startsWith('/admin/children')
    ) return '/admin/shifts/dashboard';
    return '/admin/dashboard';
  }
  if (role === '/mgr') {
    if (
      pathname.startsWith('/mgr/shifts') ||
      pathname.startsWith('/mgr/children')
    ) return '/mgr/shifts/dashboard';
    return '/mgr/dashboard';
  }
  if (role === '/my') return '/my/dashboard';
  return null;
}

export function Breadcrumb() {
  const pathname = usePathname();
  if (!pathname) return null;

  // /admin/compliance/xxx → ['', 'admin', 'compliance', 'xxx']
  const segments = pathname.split('/').filter(Boolean);

  const crumbs: { href: string; label: string; icon: string }[] = [];
  let acc = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    acc += '/' + seg;

    // ロール直下（/admin, /mgr, /my）は dashboard へリダイレクト扱い。
    // シフト系URL配下では shift dashboard を起点にする
    if (i === 0) {
      const redirect = getRoleRootRedirect(acc, pathname);
      if (redirect) {
        const meta = LABELS[redirect];
        if (meta) {
          crumbs.push({ href: redirect, label: meta.label, icon: meta.icon });
        }
        continue;
      }
    }

    const meta = LABELS[acc];
    if (meta) {
      // ロール直下の root redirect で既に追加済の同 href はスキップ
      if (crumbs.some((c) => c.href === acc)) continue;
      // /admin/shifts と /mgr/shifts は シフト表ページ自身。
      // /admin/shifts/dashboard 等のサブページからは中間に出さない（兄弟ページなので親ではない）
      if ((acc === '/admin/shifts' || acc === '/mgr/shifts') && pathname !== acc) continue;
      crumbs.push({ href: acc, label: meta.label, icon: meta.icon });
    } else {
      /* UUID セグメントはルート実体が無いことが多く（[id] の値）、
         パンくずに「詳細」として出すと 404 リンクになる。
         例: /admin/documents/<uuid>/editor は /editor がページ実体、
             <uuid> は中間パラメータでページ無し。
         UUID 形式 (8-4-4-4-12 hex) は中間として扱い、パンくずに含めない。 */
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg);
      if (isUuid) continue;
      /* 中間パス（最後のセグメントでない）でラベル未定義 = 通常はグルーピング用ディレクトリ
         （例: /admin/shifts/output, /admin/employees/[id]）でページ実体が無いので
         「詳細」リンクを出すと 404 になる。スキップして親→子を直接結ぶ。 */
      if (i < segments.length - 1) continue;
      crumbs.push({ href: acc, label: '詳細', icon: '📎' });
    }
  }

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="パンくず" className="print-hide flex items-center gap-1 text-xs text-brand-gray-light overflow-x-auto whitespace-nowrap px-4 py-2 bg-white border-b border-brand-gray/10">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={c.href} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-brand-gray-light/60 mx-0.5">/</span>}
            {isLast ? (
              <span className="text-brand-ink font-bold">
                <span className="mr-0.5">{c.icon}</span>{c.label}
              </span>
            ) : (
              <Link href={c.href} className="hover:text-brand-ink transition-colors">
                <span className="mr-0.5">{c.icon}</span>{c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
