'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { applyScopeFilter } from '@/components/admin/FacilityScopeSelector';
import { Breadcrumb } from '@/components/admin/Breadcrumb';
import { Logo } from '@/components/branding/Logo';
import type { TargetType } from '@/lib/types';

type UnreadKey = 'document' | 'compliance' | 'training' | 'announcement' | 'manual' | 'message';

const tabs: { href: string; label: string; unreadKey?: UnreadKey }[] = [
  { href: '/my/dashboard', label: 'ホーム' },
  { href: '/my/profile', label: '基本情報' },
  { href: '/my/about', label: '自己紹介' },
  { href: '/my/documents', label: '書類', unreadKey: 'document' },
  { href: '/my/compliance', label: '遵守事項', unreadKey: 'compliance' },
  { href: '/my/trainings', label: '研修', unreadKey: 'training' },
  { href: '/my/announcements', label: 'お知らせ', unreadKey: 'announcement' },
  { href: '/my/manuals', label: '業務マニュアル', unreadKey: 'manual' },
  { href: '/my/messages', label: '個別連絡', unreadKey: 'message' },
  { href: '/my/requests', label: '休み希望（+シフト）' },
];

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userRole, setUserRole] = useState<string>('employee');
  const [unread, setUnread] = useState<Record<UnreadKey, number>>({ document: 0, compliance: 0, training: 0, announcement: 0, manual: 0, message: 0 });

  useEffect(() => {
    async function loadCompany() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase.from('employees').select('id, tenant_id, role, facility_id, updated_at').eq('auth_user_id', user.id).single();
      if (!me) return;
      setUserRole(me.role);

      // 未確認/未読/未合格のカウント計算（施設スコープ考慮）
      type Row = { id: string; updated_at?: string; target_type: TargetType; target_facility_ids: string[] };
      const [compRes, trainRes, annRes, manRes, ackRes, subRes, readRes, manReadRes, threadRes, msgReadRes, docSubRes] = await Promise.all([
        // 非公開分はバッジ件数からも除外（admin/manager が社員画面を閲覧した際にも正しく動かすため明示フィルタ。employee は RLS でも除外される）
        supabase.from('compliance_documents').select('id, updated_at, target_type, target_facility_ids').eq('tenant_id', me.tenant_id).eq('is_published', true),
        supabase.from('trainings').select('id, target_type, target_facility_ids').eq('tenant_id', me.tenant_id).eq('is_published', true),
        supabase.from('announcements').select('id, target_type, target_facility_ids').eq('tenant_id', me.tenant_id).eq('is_published', true),
        supabase.from('manuals').select('id, target_type, target_facility_ids').eq('tenant_id', me.tenant_id).eq('is_published', true),
        supabase.from('compliance_acknowledgments').select('compliance_document_id, document_updated_at').eq('employee_id', me.id),
        supabase.from('training_submissions').select('training_id, result').eq('employee_id', me.id),
        supabase.from('announcement_reads').select('announcement_id').eq('employee_id', me.id),
        supabase.from('manual_reads').select('manual_id').eq('employee_id', me.id),
        /* 個別連絡の未読件数 (Phase G / migration 142) — 自分が参加するスレッドのメッセージのうち、
           自分以外が送信し、まだ message_reads に記録が無いもの */
        supabase.from('message_thread_members').select('thread_id').eq('employee_id', me.id),
        supabase.from('message_reads').select('message_id').eq('employee_id', me.id),
        /* 書類: 提出済みのうち、その後で基本情報が更新された(=要再提出)もの */
        supabase.from('document_submissions').select('id, submitted_at').eq('employee_id', me.id).eq('status', 'submitted'),
      ]);

      const scopedComp = applyScopeFilter((compRes.data || []) as Row[], me.facility_id);
      const scopedTrain = applyScopeFilter((trainRes.data || []) as Row[], me.facility_id);
      const scopedAnn = applyScopeFilter((annRes.data || []) as Row[], me.facility_id);
      const scopedMan = applyScopeFilter((manRes.data || []) as Row[], me.facility_id);

      // 現在のupdated_atバージョンでの確認済みセット
      const confirmedSet = new Set(
        ((ackRes.data || []) as { compliance_document_id: string; document_updated_at: string }[])
          .map((a) => `${a.compliance_document_id}::${a.document_updated_at}`)
      );
      const passedTrainIds = new Set(
        ((subRes.data || []) as { training_id: string; result: string }[])
          .filter((s) => s.result === 'passed')
          .map((s) => s.training_id)
      );
      const readAnnIds = new Set((readRes.data || []).map((r: { announcement_id: string }) => r.announcement_id));
      const readManIds = new Set((manReadRes.data || []).map((r: { manual_id: string }) => r.manual_id));

      /* 個別連絡 未読件数 */
      const myThreadIds = ((threadRes.data || []) as { thread_id: string }[]).map((r) => r.thread_id);
      const myReadMsgIds = new Set(((msgReadRes.data || []) as { message_id: string }[]).map((r) => r.message_id));
      let messageUnread = 0;
      if (myThreadIds.length > 0) {
        const { data: pending } = await supabase
          .from('messages')
          .select('id, sender_employee_id')
          .in('thread_id', myThreadIds)
          .neq('sender_employee_id', me.id)
          .is('deleted_at', null);
        messageUnread = ((pending || []) as { id: string }[]).filter((m) => !myReadMsgIds.has(m.id)).length;
      }

      /* 書類: 提出後に基本情報(employees.updated_at)が変わったら要再提出。
         /my/documents/page.tsx と同じロジック。 */
      const empUpdatedAt = (me.updated_at as string) ?? null;
      const docResubmit = ((docSubRes.data || []) as { submitted_at: string | null }[])
        .filter((s) => s.submitted_at && empUpdatedAt && new Date(empUpdatedAt) > new Date(s.submitted_at))
        .length;

      setUnread({
        document: docResubmit,
        compliance: scopedComp.filter((c) => c.updated_at && !confirmedSet.has(`${c.id}::${c.updated_at}`)).length,
        training: scopedTrain.filter((t) => !passedTrainIds.has(t.id)).length,
        announcement: scopedAnn.filter((a) => !readAnnIds.has(a.id)).length,
        manual: scopedMan.filter((m) => !readManIds.has(m.id)).length,
        message: messageUnread,
      });
    }
    loadCompany();
  }, [pathname]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-diletto-beige">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-diletto-gray/10 bg-white">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between px-4">
          <Link href="/my/dashboard" className="flex items-center min-w-0">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            {(userRole === 'manager' || userRole === 'admin') && (
              <Link
                href={userRole === 'manager' ? '/mgr/dashboard' : '/admin/dashboard'}
                className="text-xs text-diletto-blue hover:text-diletto-ink font-medium transition-colors whitespace-nowrap shrink-0"
              >
                管理画面
              </Link>
            )}
            <Button variant="ghost" size="sm" className="text-xs text-diletto-gray hover:text-diletto-ink whitespace-nowrap shrink-0" onClick={handleLogout}>
              ログアウト
            </Button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="mx-auto max-w-7xl overflow-x-auto px-4">
          <nav className="flex gap-0">
            {tabs.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
              const count = tab.unreadKey ? unread[tab.unreadKey] : 0;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-300 ${
                    active
                      ? 'border-b-2 border-diletto-blue text-diletto-blue'
                      : 'text-diletto-gray hover:text-diletto-ink'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {tab.label}
                    {count > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold leading-none">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Breadcrumb */}
      <Breadcrumb />

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        {children}
      </main>
    </div>
  );
}
