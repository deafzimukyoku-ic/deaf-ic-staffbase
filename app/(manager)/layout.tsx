'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Breadcrumb } from '@/components/admin/Breadcrumb';
import { Logo } from '@/components/branding/Logo';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useShiftFacilityId } from '@/lib/shift-facility';

type Mode = 'staff' | 'shift';

type NavLink = { kind: 'link'; href: string; label: string; icon: string };
type NavAccordion = { kind: 'accordion'; key: string; label: string; icon: string; children: NavLink[] };
type NavSection = { kind: 'section'; label: string };
type NavItem = NavLink | NavAccordion | NavSection;

const staffNav: NavItem[] = [
  { kind: 'link', href: '/mgr/dashboard', label: 'ダッシュボード', icon: '📊' },
  { kind: 'link', href: '/mgr/subordinates', label: '部下管理', icon: '👥' },
  { kind: 'link', href: '/mgr/compliance', label: '遵守事項', icon: '✅' },
  { kind: 'link', href: '/mgr/trainings', label: '研修', icon: '📚' },
  { kind: 'link', href: '/mgr/announcements', label: 'お知らせ', icon: '📢' },
  { kind: 'link', href: '/mgr/manuals', label: '業務マニュアル', icon: '📖' },
  { kind: 'link', href: '/mgr/reports', label: '閲覧レポート', icon: '📊' },
];

const shiftNav: NavItem[] = [
  { kind: 'link', href: '/mgr/shifts/dashboard', label: 'ダッシュボード', icon: '📊' },
  { kind: 'link', href: '/mgr/shifts/schedule', label: '利用表', icon: '📅' },
  { kind: 'link', href: '/mgr/shifts', label: 'シフト表', icon: '🗓️' },
  { kind: 'link', href: '/mgr/shifts/transport', label: '送迎表', icon: '🚗' },
  { kind: 'link', href: '/mgr/shifts/output/daily', label: '日次出力', icon: '📄' },
  { kind: 'link', href: '/mgr/shifts/output/daily-report', label: '業務日報', icon: '📋' },
  { kind: 'link', href: '/mgr/shifts/output/billing', label: '利用料金表', icon: '💰' },
  /* 週次送迎は送迎表ページの出力ボタンに統合（サイドバーからは除外） */
  { kind: 'link', href: '/mgr/requests', label: '休み希望', icon: '✋' },
  {
    kind: 'accordion',
    key: 'shift-settings',
    label: 'シフト設定',
    icon: '⚙️',
    children: [
      { kind: 'link', href: '/mgr/shifts/facility-settings', label: '事業所設定', icon: '🏢' },
      { kind: 'link', href: '/mgr/shifts/staff-settings', label: '職員管理', icon: '👔' },
      { kind: 'link', href: '/mgr/children', label: '児童管理', icon: '👶' },
      { kind: 'link', href: '/mgr/shifts/events', label: 'イベント設定', icon: '🎉' },
    ],
  },
];

function detectModeFromPath(path: string): Mode | null {
  if (
    path.startsWith('/mgr/children') ||
    path.startsWith('/mgr/shifts/')
  ) return 'shift';
  if (
    path === '/mgr/shifts' || path === '/mgr/requests'
  ) return null;
  if (
    path.startsWith('/mgr/subordinates') ||
    path.startsWith('/mgr/compliance') ||
    path.startsWith('/mgr/trainings') ||
    path.startsWith('/mgr/announcements') ||
    path.startsWith('/mgr/manuals') ||
    path === '/mgr/dashboard'
  ) return 'staff';
  return null;
}

function isActive(pathname: string, href: string): boolean {
  if (href === pathname) return true;
  if (href === '/mgr/shifts' || href === '/mgr/dashboard') {
    return pathname === href;
  }
  return pathname.startsWith(href + '/');
}

function SidebarNav({
  pathname,
  mode,
  onNavigate,
  transportEnabled,
  shiftOnlyMode,
}: {
  pathname: string;
  mode: Mode;
  onNavigate?: () => void;
  /** false の場合、シフトモードのナビから送迎表を除外（migration 116） */
  transportEnabled: boolean;
  /** true の場合、シフトモードのナビをシフト表 / 休み希望 / 職員管理 / ダッシュボードのみに絞る（migration 125） */
  shiftOnlyMode: boolean;
}) {
  const baseItems = mode === 'staff' ? staffNav : shiftNav;
  let items = baseItems;
  if (mode === 'shift') {
    if (shiftOnlyMode) {
      const keepHrefs = new Set([
        '/mgr/shifts/dashboard',
        '/mgr/shifts',
        '/mgr/requests',
        '/mgr/shifts/staff-settings',
      ]);
      items = baseItems.flatMap<NavItem>((it) => {
        if (it.kind === 'section') return [it];
        if (it.kind === 'link') return keepHrefs.has(it.href) ? [it] : [];
        if (it.kind === 'accordion') {
          const kept = it.children.filter((c) => keepHrefs.has(c.href));
          return kept.length > 0 ? [{ ...it, children: kept }] : [];
        }
        return [];
      });
    } else if (!transportEnabled) {
      items = baseItems.filter((it) => it.kind !== 'link' || it.href !== '/mgr/shifts/transport');
    }
  }
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
        {mode === 'staff' ? '📋 部下管理モード' : '🚐 シフト・送迎モード'}
      </p>
    </div>
  );
}

function SidebarContent({
  pathname,
  mode,
  onNavigate,
  transportEnabled,
  shiftOnlyMode,
}: {
  pathname: string;
  mode: Mode;
  onNavigate?: () => void;
  transportEnabled: boolean;
  shiftOnlyMode: boolean;
}) {
  const homeHref = mode === 'staff' ? '/mgr/dashboard' : '/mgr/shifts/dashboard';
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex border-b border-diletto-gray/10 h-[60px] items-center px-4">
        <Link href={homeHref} onClick={onNavigate}>
          <Logo size="md" />
        </Link>
      </div>
      <ModeLabel mode={mode} />
      {/* 常時表示スクロールバーで「下にもう項目あるよ」を視覚化（admin と同方針） */}
      <div className="flex-1 overflow-y-auto py-3 sidebar-scroll">
        <SidebarNav
          pathname={pathname}
          mode={mode}
          onNavigate={onNavigate}
          transportEnabled={transportEnabled}
          shiftOnlyMode={shiftOnlyMode}
        />
      </div>
      <div className="border-t border-diletto-gray/10 bg-diletto-beige p-3 space-y-1">
        <p className="text-[10px] text-diletto-gray-light px-1 mb-1">切り替え</p>
        <Link
          href="/my/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-diletto-gray hover:bg-white hover:text-diletto-ink transition-colors"
        >
          <span>👤</span>
          <span>社員画面</span>
        </Link>
      </div>
    </div>
  );
}

function ModeFab({
  mode,
  onSwitch,
}: {
  mode: Mode;
  onSwitch: () => void;
}) {
  const other: Mode = mode === 'staff' ? 'shift' : 'staff';
  const label = other === 'shift' ? '送迎表・シフトへ' : '部下管理へ';
  const icon = other === 'shift' ? '🚐' : '📋';
  // デフォルトはアイコンのみのコンパクト円。ホバーで展開してラベル表示。
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

type FacilityLite = {
  id: string;
  name: string;
  /** migration 116: false なら送迎関連 sidebar 項目を非表示 */
  transport_enabled?: boolean;
  /** migration 125: true なら sidebar をシフト表 / 休み希望 / 職員管理 / ダッシュボードのみに絞る */
  shift_only_mode?: boolean;
};

function FacilityHeaderSelector({ facilities, value, onChange }: { facilities: FacilityLite[]; value: string | null; onChange: (id: string) => void }) {
  if (facilities.length === 0) return null;
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-diletto-gray/15 bg-white px-2 text-xs font-bold text-diletto-ink hover:border-diletto-blue focus:outline-none focus:border-diletto-blue"
      title="担当施設"
    >
      {facilities.length > 1 && value === null && <option value="">担当施設を選択</option>}
      {facilities.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </select>
  );
}

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [greeting, setGreeting] = useState({ companyName: '', userName: '' });
  const [mode, setMode] = useState<Mode>('staff');
  const [facilities, setFacilities] = useState<FacilityLite[]>([]);
  const [facilityId, setFacilityId] = useShiftFacilityId();

  /* 選択中事業所のフラグ（migration 116 / 125） */
  const transportEnabled = useMemo(() => {
    if (!facilityId) return true;
    const f = facilities.find((x) => x.id === facilityId);
    return f ? f.transport_enabled !== false : true;
  }, [facilities, facilityId]);
  const shiftOnlyMode = useMemo(() => {
    if (!facilityId) return false;
    const f = facilities.find((x) => x.id === facilityId);
    return f ? f.shift_only_mode === true : false;
  }, [facilities, facilityId]);

  useEffect(() => {
    const detected = detectModeFromPath(pathname);
    if (detected) {
      setMode(detected);
      try { localStorage.setItem('mgr-mode', detected); } catch { /* noop */ }
      return;
    }
    try {
      const saved = localStorage.getItem('mgr-mode');
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
        .select('id, last_name, first_name, tenant_id, facility_id')
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

      /* 担当施設取得（manager_facilities + 自分の facility）。
         migration 116: shift_enabled=false の施設は除外 + display_order 順 + transport_enabled
         migration 125: shift_only_mode も取得（sidebar フィルタに使用） */
      const facCols = 'id, name, display_order, shift_enabled, transport_enabled, shift_only_mode';
      const { data: mfs } = await supabase
        .from('manager_facilities')
        .select(`facility_id, facility:facilities(${facCols})`)
        .eq('employee_id', emp.id);
      type FacilityWithMeta = FacilityLite & { display_order: number; shift_enabled: boolean };
      const collected: FacilityWithMeta[] = [];
      const seen = new Set<string>();
      if (emp.facility_id) {
        const { data: own } = await supabase
          .from('facilities')
          .select(facCols)
          .eq('id', emp.facility_id)
          .single();
        /* shift_only_mode=true は shift_enabled=false を上書きしてセレクタに表示（migration 125） */
        if (own && (own.shift_enabled !== false || own.shift_only_mode === true)) {
          collected.push({
            id: own.id,
            name: own.name,
            display_order: own.display_order ?? 0,
            shift_enabled: own.shift_enabled ?? true,
            transport_enabled: own.transport_enabled ?? true,
            shift_only_mode: own.shift_only_mode === true,
          });
          seen.add(own.id);
        }
      }
      for (const mf of (mfs || [])) {
        const raw = (mf as unknown as {
          facility:
            | { id: string; name: string; display_order: number; shift_enabled: boolean; transport_enabled?: boolean; shift_only_mode?: boolean }
            | { id: string; name: string; display_order: number; shift_enabled: boolean; transport_enabled?: boolean; shift_only_mode?: boolean }[]
            | null;
        }).facility;
        const f = Array.isArray(raw) ? raw[0] : raw;
        if (f && !seen.has(f.id) && (f.shift_enabled !== false || f.shift_only_mode === true)) {
          collected.push({
            id: f.id,
            name: f.name,
            display_order: f.display_order ?? 0,
            shift_enabled: f.shift_enabled ?? true,
            transport_enabled: f.transport_enabled ?? true,
            shift_only_mode: f.shift_only_mode === true,
          });
          seen.add(f.id);
        }
      }
      collected.sort((a, b) => a.display_order - b.display_order);
      const list: FacilityLite[] = collected.map(({ id, name, transport_enabled, shift_only_mode }) => ({
        id,
        name,
        transport_enabled,
        shift_only_mode,
      }));
      setFacilities(list);

      /* ① 仕様: 初期値は本人の所属施設 (emp.facility_id) を優先。
         localStorage 保存値が現リストに含まれるなら維持。 */
      const inAllowed = (id: string | null) => !!id && list.some((f) => f.id === id);
      if (inAllowed(facilityId)) {
        /* keep */
      } else if (inAllowed(emp.facility_id)) {
        setFacilityId(emp.facility_id!);
      } else if (list.length > 0) {
        setFacilityId(list[0].id);
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
    try { localStorage.setItem('mgr-mode', next); } catch { /* noop */ }
    const target = next === 'staff' ? '/mgr/dashboard' : '/mgr/shifts/dashboard';
    router.push(target);
  }

  const greetingText = greeting.companyName && greeting.userName
    ? `${greeting.companyName}　${greeting.userName}さん`
    : '';

  return (
    <div className="flex h-screen bg-diletto-beige">
      <aside className="hidden lg:flex lg:flex-col border-r border-diletto-gray/10 w-64">
        <SidebarContent pathname={pathname} mode={mode} transportEnabled={transportEnabled} shiftOnlyMode={shiftOnlyMode} />
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-[60px] items-center gap-3 border-b border-diletto-gray/10 bg-white px-4 lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger className="flex items-center justify-center h-9 w-9 shrink-0 rounded-md text-diletto-ink hover:bg-diletto-beige">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] p-0" style={{ height: '100dvh' }}>
              <SidebarContent pathname={pathname} mode={mode} onNavigate={() => setMobileOpen(false)} transportEnabled={transportEnabled} shiftOnlyMode={shiftOnlyMode} />
            </SheetContent>
          </Sheet>
          <Link href={mode === 'staff' ? '/mgr/dashboard' : '/mgr/shifts/dashboard'} className="flex items-center min-w-0 shrink">
            <Logo size="sm" />
          </Link>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <FacilityHeaderSelector facilities={facilities} value={facilityId} onChange={setFacilityId} />
            <Link href="/my/dashboard" className="text-xs text-diletto-blue hover:text-diletto-ink font-medium transition-colors whitespace-nowrap shrink-0">
              社員画面
            </Link>
            <Button variant="ghost" size="sm" className="text-xs text-diletto-gray hover:text-diletto-ink whitespace-nowrap shrink-0" onClick={handleLogout}>
              ログアウト
            </Button>
          </div>
        </header>

        <header className="hidden lg:flex h-[60px] items-center justify-between border-b border-diletto-gray/10 bg-white px-6">
          <div>
            {greetingText ? (
              <>
                <p className="text-base font-bold text-diletto-ink">おかえりなさい、{greetingText}</p>
                <p className="text-xs text-diletto-gray-light">
                  {mode === 'staff'
                    ? '担当施設の社員と研修を管理できます。'
                    : '担当施設のシフト・送迎を管理できます。'}
                </p>
              </>
            ) : (
              <p className="text-xs text-diletto-gray-light">読み込み中...</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <FacilityHeaderSelector facilities={facilities} value={facilityId} onChange={setFacilityId} />
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
