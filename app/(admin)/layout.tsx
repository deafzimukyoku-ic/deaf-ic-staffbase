'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Breadcrumb } from '@/components/admin/Breadcrumb';
import { Logo } from '@/components/branding/Logo';
import { useShiftFacilityId, setStoredFacilityId } from '@/lib/shift-facility';
import type { Facility } from '@/lib/types';

type Mode = 'staff' | 'shift';

type NavLink = { kind: 'link'; href: string; label: string; icon: string };
type NavAccordion = { kind: 'accordion'; key: string; label: string; icon: string; children: NavLink[] };
type NavSection = { kind: 'section'; label: string };
type NavItem = NavLink | NavAccordion | NavSection;

// 社員モードのサイドバー
const staffNav: NavItem[] = [
  { kind: 'link', href: '/admin/dashboard', label: 'ダッシュボード', icon: '📊' },
  { kind: 'link', href: '/admin/employees', label: '社員管理', icon: '👥' },
  { kind: 'link', href: '/admin/compliance', label: '遵守事項', icon: '✅' },
  { kind: 'link', href: '/admin/trainings', label: '研修', icon: '📚' },
  { kind: 'link', href: '/admin/announcements', label: 'お知らせ', icon: '📢' },
  { kind: 'link', href: '/admin/manuals', label: '業務マニュアル', icon: '📖' },
  { kind: 'link', href: '/admin/reports', label: '閲覧レポート', icon: '📊' },
  /* チーム診断は /admin/employees の社員一覧画面から起動 */
  { kind: 'link', href: '/admin/access-matrix', label: 'アプリ権限管理', icon: '🔐' },
  { kind: 'link', href: '/admin/settings', label: '設定', icon: '⚙️' },
];

// シフトモードのサイドバー（作業順序順）
const shiftNav: NavItem[] = [
  { kind: 'link', href: '/admin/shifts/dashboard', label: 'ダッシュボード', icon: '📊' },
  { kind: 'link', href: '/admin/shifts/schedule', label: '利用表', icon: '📅' },
  { kind: 'link', href: '/admin/shifts', label: 'シフト表', icon: '🗓️' },
  { kind: 'link', href: '/admin/shifts/transport', label: '送迎表', icon: '🚗' },
  { kind: 'link', href: '/admin/shifts/output/daily', label: '日次出力', icon: '📄' },
  { kind: 'link', href: '/admin/shifts/output/daily-report', label: '業務日報', icon: '📋' },
  /* 週次送迎は送迎表ページの出力ボタンに統合（サイドバーからは除外） */
  { kind: 'link', href: '/admin/requests', label: '休み希望', icon: '✋' },
  { kind: 'section', label: '⚙️ シフト設定' },
  { kind: 'link', href: '/admin/shifts/facility-settings', label: '事業所設定', icon: '🏢' },
  { kind: 'link', href: '/admin/shifts/staff-settings', label: '職員管理', icon: '👔' },
  { kind: 'link', href: '/admin/children', label: '児童管理', icon: '👶' },
];

// URL から mode を判定（shift系パスなら shift、それ以外は null=判定不能で localStorage に委ねる）
function detectModeFromPath(path: string): Mode | null {
  if (
    path.startsWith('/admin/children') ||
    path.startsWith('/admin/shifts/')
  ) return 'shift';
  if (
    path === '/admin/shifts' || path === '/admin/requests'
  ) return null; // 共有URL。モード据え置き
  if (
    path.startsWith('/admin/employees') ||
    path.startsWith('/admin/documents') ||
    path.startsWith('/admin/compliance') ||
    path.startsWith('/admin/trainings') ||
    path.startsWith('/admin/announcements') ||
    path.startsWith('/admin/manuals') ||
    path.startsWith('/admin/team-diagnosis') ||
    path.startsWith('/admin/settings') ||
    path === '/admin/dashboard'
  ) return 'staff';
  return null;
}

function isActive(pathname: string, href: string): boolean {
  if (href === pathname) return true;
  // /admin/shifts が prefix として /admin/shifts/dashboard 等にマッチしてしまうのを防ぐ
  if (href === '/admin/shifts' || href === '/admin/dashboard') {
    return pathname === href;
  }
  return pathname.startsWith(href + '/');
}

function SidebarNav({
  pathname,
  mode,
  onNavigate,
  transportEnabled,
}: {
  pathname: string;
  mode: Mode;
  onNavigate?: () => void;
  /** false の場合、シフトモードのナビから送迎表 / 週次送迎を除外（migration 116） */
  transportEnabled: boolean;
}) {
  const baseItems = mode === 'staff' ? staffNav : shiftNav;
  const items = mode === 'shift' && !transportEnabled
    ? baseItems.filter((it) => it.kind !== 'link' || it.href !== '/admin/shifts/transport')
    : baseItems;

  // アコーディオン展開状態（デフォルト: そのアコーディオン配下のURLがアクティブなら展開）
  const initialOpen = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const item of items) {
      if (item.kind === 'accordion') {
        map[item.key] = item.children.some((c) => isActive(pathname, c.href));
      }
    }
    return map;
  }, [items, pathname]);
  const [open, setOpen] = useState<Record<string, boolean>>(initialOpen);

  return (
    <nav className="space-y-1 px-3">
      {items.map((item, idx) => {
        if (item.kind === 'section') {
          return (
            <div key={`sec-${idx}`} className="pt-3 mt-2 border-t border-diletto-gray/15">
              <p className="px-3 pt-1 pb-1 text-[10px] font-bold text-diletto-gray-light uppercase tracking-widest">
                {item.label}
              </p>
            </div>
          );
        }
        if (item.kind === 'accordion') {
          const anyActive = item.children.some((c) => isActive(pathname, c.href));
          const expanded = open[item.key] ?? anyActive;
          return (
            <div key={item.key}>
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [item.key]: !expanded }))}
                className={`flex w-full items-center gap-3 rounded-md text-sm font-medium transition-all duration-300 px-3 py-2.5 ${
                  anyActive
                    ? 'bg-diletto-beige text-diletto-ink'
                    : 'text-diletto-gray hover:bg-diletto-beige hover:text-diletto-ink'
                }`}
                aria-expanded={expanded}
              >
                <span className="text-base shrink-0">{item.icon}</span>
                <span className="flex-1 text-left">{item.label}</span>
                <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
              </button>
              {expanded && (
                <div className="ml-3 mt-1 space-y-1 border-l border-diletto-gray/10 pl-2">
                  {item.children.map((c) => {
                    const active = isActive(pathname, c.href);
                    return (
                      <Link
                        key={c.href}
                        href={c.href}
                        onClick={onNavigate}
                        className={`flex items-center gap-2 rounded-md text-sm transition-all px-3 py-2 ${
                          active
                            ? 'bg-diletto-ink text-white shadow-sm font-medium'
                            : 'text-diletto-gray hover:bg-diletto-beige hover:text-diletto-ink'
                        }`}
                      >
                        <span className="text-[8px] shrink-0 opacity-60">●</span>
                        <span>{c.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-md text-sm font-medium transition-all duration-300 px-3 py-2.5 ${
              active
                ? 'bg-diletto-ink text-white shadow-sm'
                : 'text-diletto-gray hover:bg-diletto-beige hover:text-diletto-ink'
            }`}
          >
            <span className="text-base shrink-0">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ModeLabel({ mode }: { mode: Mode }) {
  return (
    <div className="px-4 py-2 border-b border-diletto-gray/10 bg-diletto-beige/50">
      <p className="text-[10px] font-bold text-diletto-gray-light uppercase tracking-widest">
        {mode === 'staff' ? '📋 社員管理モード' : '🚐 シフト・送迎モード'}
      </p>
    </div>
  );
}

function SidebarContent({
  pathname,
  mode,
  onNavigate,
  transportEnabled,
}: {
  pathname: string;
  mode: Mode;
  onNavigate?: () => void;
  transportEnabled: boolean;
}) {
  const homeHref = mode === 'staff' ? '/admin/dashboard' : '/admin/shifts/dashboard';
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex border-b border-diletto-gray/10 h-[60px] items-center px-4">
        <Link href={homeHref} onClick={onNavigate}>
          <Logo size="md" />
        </Link>
      </div>
      <ModeLabel mode={mode} />
      {/* 常時表示スクロールバーで「下にもう項目あるよ」を視覚化。
         ScrollArea は base-ui のカスタム実装だが thumb が控えめすぎるので native overflow に置換。
         WebKit 系のスクロールバーをカラーリングして diletto テイストに合わせる。 */}
      <div className="flex-1 overflow-y-auto py-3 sidebar-scroll">
        <SidebarNav pathname={pathname} mode={mode} onNavigate={onNavigate} transportEnabled={transportEnabled} />
      </div>
    </div>
  );
}

// 右下フローティングボタン。現モードの反対モードへジャンプする。
function ModeFab({
  mode,
  onSwitch,
}: {
  mode: Mode;
  onSwitch: () => void;
}) {
  const other: Mode = mode === 'staff' ? 'shift' : 'staff';
  const label = other === 'shift' ? '送迎表・シフトへ' : '社員管理へ';
  const icon = other === 'shift' ? '🚐' : '📋';
  // デフォルトはアイコンのみのコンパクト円 (56x56)。ホバーで横に広がってラベル表示。
  // コンテンツ（テーブル等）の右端を覆わない。
  return (
    <button
      type="button"
      onClick={onSwitch}
      className="print-hide fixed bottom-6 right-6 z-50 flex items-center gap-2 h-14 rounded-full bg-diletto-ink text-white shadow-lg hover:bg-black transition-all hover:shadow-xl group overflow-hidden whitespace-nowrap pl-3 pr-3 max-w-14 hover:max-w-xs hover:pr-5 duration-300"
      aria-label={label}
      title={label}
    >
      <span className="text-2xl shrink-0 leading-none">{icon}</span>
      <span className="hidden sm:inline text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-100">{label}</span>
    </button>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [greeting, setGreeting] = useState({ companyName: '', userName: '' });
  const [mode, setMode] = useState<Mode>('staff');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [shiftFacilityId] = useShiftFacilityId();
  /* migration 116: 選択中事業所の transport_enabled が false なら nav から送迎関連を非表示 */
  const transportEnabled = useMemo(() => {
    if (!shiftFacilityId) return true;
    const f = facilities.find((x) => x.id === shiftFacilityId);
    return f ? (f as Facility & { transport_enabled?: boolean }).transport_enabled !== false : true;
  }, [facilities, shiftFacilityId]);

  // localStorage から復元 + URL 判定で上書き
  useEffect(() => {
    const detected = detectModeFromPath(pathname);
    if (detected) {
      setMode(detected);
      try { localStorage.setItem('admin-mode', detected); } catch { /* noop */ }
      return;
    }
    // detected が null（共有URL）の場合は保存済みmodeを採用
    try {
      const saved = localStorage.getItem('admin-mode');
      if (saved === 'staff' || saved === 'shift') setMode(saved);
    } catch { /* noop */ }
  }, [pathname]);

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: emp } = await supabase
        .from('employees')
        .select('last_name, first_name, tenant_id, facility_id')
        .eq('auth_user_id', user.id)
        .single();
      if (!emp) return;

      const { data: tenant } = await supabase
        .from('tenants')
        .select('company_name')
        .eq('id', emp.tenant_id)
        .single();

      setGreeting({
        companyName: tenant?.company_name || '',
        userName: `${emp.last_name} ${emp.first_name}`.trim(),
      });

      /* facility 一覧（シフトモード上部セレクタ用）。
         migration 116: display_order 順 + shift_enabled=true のみセレクタに出す。 */
      const { data: facData } = await supabase
        .from('facilities')
        .select('id, tenant_id, name, address, created_at, display_order, shift_enabled, transport_enabled')
        .eq('tenant_id', emp.tenant_id)
        .eq('shift_enabled', true)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });
      const all = (facData as Facility[]) || [];
      setFacilities(all);
      /* 初期選択ロジック（① 仕様改）:
         admin はレイアウトマウント（ログイン直後・リロード・新規タブ）のたびに
         「自分の所属施設」を優先で再セット。同タブ内のドロップダウン切替は
         localStorage 経由で維持され、内部ナビでは layout が再マウントされないため失われない。
         所属が現リストに含まれない（ shift_enabled=false 等）場合のみ stored / 先頭にフォールバック。 */
      const stored = (() => {
        try { return localStorage.getItem('shift-facility-id'); } catch { return null; }
      })();
      const inAllowed = (id: string | null) => !!id && all.some((f) => f.id === id);
      if (inAllowed(emp.facility_id)) {
        setStoredFacilityId(emp.facility_id!);
      } else if (inAllowed(stored)) {
        /* keep */
      } else if (all.length > 0) {
        setStoredFacilityId(all[0].id);
      }
    }
    loadUser();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function switchMode() {
    const next: Mode = mode === 'staff' ? 'shift' : 'staff';
    setMode(next);
    try { localStorage.setItem('admin-mode', next); } catch { /* noop */ }
    // そのモードのダッシュボードへジャンプ
    const target = next === 'staff' ? '/admin/dashboard' : '/admin/shifts/dashboard';
    router.push(target);
  }

  const greetingText = greeting.companyName && greeting.userName
    ? `${greeting.companyName}　${greeting.userName}さん`
    : greeting.companyName
      ? greeting.companyName
      : '';

  return (
    <div className="flex h-screen bg-diletto-beige">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col border-r border-diletto-gray/10 w-64">
        <SidebarContent pathname={pathname} mode={mode} transportEnabled={transportEnabled} />
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="flex h-[60px] items-center gap-3 border-b border-diletto-gray/10 bg-white px-4 lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger className="flex items-center justify-center h-9 w-9 shrink-0 rounded-md text-diletto-ink hover:bg-diletto-beige">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] p-0" style={{ height: '100dvh' }}>
              <SidebarContent pathname={pathname} mode={mode} onNavigate={() => setMobileOpen(false)} transportEnabled={transportEnabled} />
            </SheetContent>
          </Sheet>
          <Link href={mode === 'staff' ? '/admin/dashboard' : '/admin/shifts/dashboard'} className="flex items-center min-w-0 shrink">
            <Logo size="sm" />
          </Link>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {mode === 'shift' && facilities.length > 1 && (
              <select
                value={shiftFacilityId ?? ''}
                onChange={(e) => setStoredFacilityId(e.target.value)}
                className="h-8 rounded-md border border-diletto-gray/15 bg-white px-2 text-xs font-medium text-diletto-ink max-w-[100px]"
                aria-label="表示中の事業所"
              >
                {facilities.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            )}
            <Link href="/my/dashboard" className="text-xs text-diletto-blue hover:text-diletto-ink font-medium transition-colors whitespace-nowrap shrink-0">
              社員画面
            </Link>
            <Button variant="ghost" size="sm" className="text-xs text-diletto-gray hover:text-diletto-ink whitespace-nowrap shrink-0" onClick={handleLogout}>
              ログアウト
            </Button>
          </div>
        </header>

        {/* Desktop topbar */}
        <header className="hidden lg:flex h-[60px] items-center justify-between border-b border-diletto-gray/10 bg-white px-6">
          <div>
            {greetingText ? (
              <>
                <p className="text-base font-bold text-diletto-ink">おかえりなさい、{greetingText}</p>
                <p className="text-xs text-diletto-gray-light">
                  {mode === 'staff'
                    ? 'アカウントの概要と利用状況を確認できます。'
                    : 'シフト・送迎の運用を管理できます。'}
                </p>
              </>
            ) : (
              <p className="text-xs text-diletto-gray-light">読み込み中...</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {mode === 'shift' && facilities.length > 1 && (
              <select
                value={shiftFacilityId ?? ''}
                onChange={(e) => setStoredFacilityId(e.target.value)}
                className="h-9 rounded-md border border-diletto-gray/15 bg-white px-3 text-sm font-medium text-diletto-ink"
                aria-label="表示中の事業所"
              >
                {facilities.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            )}
            <Link href="/my/dashboard" className="text-xs text-diletto-blue hover:text-diletto-ink font-medium transition-colors">
              社員画面
            </Link>
            <Button variant="ghost" size="sm" className="text-xs text-diletto-gray hover:text-diletto-ink" onClick={handleLogout}>
              ログアウト
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto relative">
          <Breadcrumb />
          <div className="mx-auto max-w-7xl p-6 lg:p-8 pb-24">
            {children}
          </div>
        </main>
      </div>

      {/* モバイル Sheet を開いている間は FAB を隠す（z-50 同士で被るため） */}
      {!mobileOpen && <ModeFab mode={mode} onSwitch={switchMode} />}
    </div>
  );
}
