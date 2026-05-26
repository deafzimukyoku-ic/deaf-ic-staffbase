'use client';

/**
 * 個別メッセージ機能 — Phase G
 *
 * 左ペイン: スレッド一覧（最終メッセージ要約 + 未読バッジ）
 * 右ペイン: 選択スレッドのメッセージ履歴 + 入力欄 + 添付
 *
 * 役割別:
 * - admin / manager: 「+ 新規」で社員を選んでスレッド作成可
 *   manager は自管轄施設の社員のみ選択可
 * - employee: 受信スレッドの閲覧 + 返信のみ
 *
 * 添付: 画像 + PDF のみ、各 10MB 上限
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { createClient } from '@/lib/supabase/client';
import { staffDisplayName } from '@/lib/shift-utils';
import { fetchEmployeeIdsForFacilities } from '@/lib/multi-facility';
import { notifyBadgeRefresh } from '@/lib/badge-refresh';
import Button from '@/components/shift-compat/Button';
import { AttachmentDropZone } from '@/components/messages/AttachmentDropZone';
import type {
  MessageRow,
  MessageThreadRow,
  MessageThreadSummary,
} from '@/lib/types';

const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_ALLOWED_MIME = /^(image\/|application\/pdf$)/;
const STORAGE_BUCKET = 'message-attachments';

/* Supabase Storage の object key は ASCII safe 文字のみ許可
   (日本語・空白・記号などで "Invalid key" が出る)。
   元のファイル名は message_attachments.file_name に保存しているので、
   Storage キーは UUID + 拡張子だけで一意化する。 */
function buildStorageKey(messageId: string, originalName: string): string {
  const lastDot = originalName.lastIndexOf('.');
  const rawExt = lastDot >= 0 ? originalName.slice(lastDot + 1) : '';
  /* 拡張子からも非 ASCII / 危険文字を除去。空なら 'bin' */
  const safeExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10) || 'bin';
  return `${messageId}/${crypto.randomUUID()}.${safeExt}`;
}

/**
 * 受信者に🔔通知行を挿入。
 * 通知本文の event_target_title には、メッセージ本文 80 字までを格納する。
 * RLS で notifications テーブルへの INSERT が制限されている場合に備えて
 * エラーは握り潰す（メッセージ送信自体は成功扱いにする）。
 */
async function insertMessageNotifications(
  supabase: ReturnType<typeof createClient>,
  me: { id: string; tenant_id: string; last_name: string; first_name: string; facility_id: string | null },
  threadId: string,
  preview: string,
) {
  /* スレッド参加者を取得 */
  const { data: members } = await supabase
    .from('message_thread_members')
    .select('employee_id')
    .eq('thread_id', threadId);
  const recipientIds = (members ?? [])
    .map((m: { employee_id: string }) => m.employee_id)
    .filter((eid: string) => eid !== me.id);
  if (recipientIds.length === 0) return;

  let actorFacilityName: string | null = null;
  if (me.facility_id) {
    const { data: fac } = await supabase
      .from('facilities')
      .select('name')
      .eq('id', me.facility_id)
      .single();
    if (fac) actorFacilityName = fac.name;
  }

  const truncated = preview.length > 80 ? preview.slice(0, 80) + '…' : preview;
  const rows = recipientIds.map((rid: string) => ({
    tenant_id: me.tenant_id,
    recipient_employee_id: rid,
    actor_employee_id: me.id,
    actor_name: `${me.last_name} ${me.first_name}`.trim(),
    actor_facility_name: actorFacilityName,
    event_type: 'direct_message' as const,
    event_target_id: threadId,
    event_target_title: truncated,
  }));
  await supabase.from('notifications').insert(rows);
}

type Scope = 'admin' | 'manager' | 'employee';

interface Props {
  scope: Scope;
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
  role: 'admin' | 'manager' | 'employee';
  last_name: string;
  first_name: string;
}

interface EmployeePick {
  id: string;
  name: string;
  facility_id: string | null;
}

interface AttachmentInfo {
  id: string;
  file_name: string;
  mime_type: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  /* 178: 外部 URL リンク添付 (PDF/動画/Google Drive 等) */
  link_url: string | null;
}

interface MessageWithAttachments extends MessageRow {
  attachments: AttachmentInfo[];
}

export default function MessagesView({ scope }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  /* ?to=<employee_id> で起動時に新規スレッド作成ダイアログを宛先プリセットで開く */
  const presetRecipientId = searchParams?.get('to') ?? null;
  const [me, setMe] = useState<MeRow | null>(null);
  const [threads, setThreads] = useState<MessageThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageWithAttachments[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composerBody, setComposerBody] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  /* 178: 外部 URL リンク添付 (PDF/動画/Google Drive 等を URL で共有) */
  const [pendingLinks, setPendingLinks] = useState<{ url: string; label: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showNewThread, setShowNewThread] = useState(false);
  const [presetUsed, setPresetUsed] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  /* preset 宛先指定があれば自動で新規ダイアログを開く（一度だけ） */
  useEffect(() => {
    if (presetRecipientId && me && !presetUsed && (scope === 'admin' || scope === 'manager')) {
      setShowNewThread(true);
      setPresetUsed(true);
    }
  }, [presetRecipientId, me, presetUsed, scope]);

  /* --- 初期ロード --- */
  const loadMe = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id, role, last_name, first_name')
      .eq('auth_user_id', user.id)
      .single();
    if (data) setMe(data as MeRow);
  }, [supabase]);

  const loadThreads = useCallback(async () => {
    if (!me) return;
    setLoadingThreads(true);
    /* 自分が参加しているスレッド一覧を取得（RLS が他は弾く） */
    const { data: members } = await supabase
      .from('message_thread_members')
      .select('thread_id')
      .eq('employee_id', me.id);
    const threadIds = (members ?? []).map((m) => m.thread_id);

    if (threadIds.length === 0) {
      setThreads([]);
      setLoadingThreads(false);
      return;
    }

    const [{ data: tdata }, { data: allMembers }, { data: lastMsgs }, { data: reads }] = await Promise.all([
      supabase.from('message_threads').select('*').in('id', threadIds),
      supabase
        .from('message_thread_members')
        .select('thread_id, employee_id, employees:employees!inner(id, last_name, first_name)')
        .in('thread_id', threadIds),
      /* 各スレッドの最新メッセージ。手動 group by は postgrest で重いので全部取って JS 集約 */
      supabase
        .from('messages')
        .select('id, thread_id, body, deleted_at, created_at, sender_employee_id')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('message_reads')
        .select('message_id')
        .eq('employee_id', me.id),
    ]);

    const readSet = new Set((reads ?? []).map((r) => r.message_id));
    type LastMsg = { id: string; thread_id: string; body: string; deleted_at: string | null; sender_employee_id: string };
    type MemberJoin = {
      thread_id: string;
      employee_id: string;
      employees: { id: string; last_name: string | null; first_name: string | null }
            | { id: string; last_name: string | null; first_name: string | null }[]
            | null;
    };

    /* スレッドごとの最新 1 件抽出 */
    const lastByThread = new Map<string, LastMsg>();
    for (const m of (lastMsgs ?? []) as LastMsg[]) {
      if (!lastByThread.has(m.thread_id)) lastByThread.set(m.thread_id, m);
    }

    /* スレッドごとの参加者 */
    const membersByThread = new Map<string, { id: string; name: string }[]>();
    for (const row of (allMembers ?? []) as MemberJoin[]) {
      const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees;
      if (!emp) continue;
      const arr = membersByThread.get(row.thread_id) ?? [];
      arr.push({
        id: emp.id,
        name: staffDisplayName({ last_name: emp.last_name, first_name: emp.first_name }),
      });
      membersByThread.set(row.thread_id, arr);
    }

    /* 未読数: そのスレッド内で「自分以外が送って」「自分が read していない」メッセージ */
    const unreadByThread = new Map<string, number>();
    for (const m of (lastMsgs ?? []) as LastMsg[]) {
      if (m.sender_employee_id === me.id) continue;
      if (readSet.has(m.id)) continue;
      if (m.deleted_at) continue;
      unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) ?? 0) + 1);
    }

    const summaries: MessageThreadSummary[] = (tdata ?? []).map((t: MessageThreadRow) => {
      const members = membersByThread.get(t.id) ?? [];
      const others = members.filter((m) => m.id !== me.id);
      const counterpartLabel =
        others.length === 0 ? '（自分のみ）'
        : others.length === 1 ? others[0].name
        : `${others[0].name} 他 ${others.length - 1}名`;
      const last = lastByThread.get(t.id);
      return {
        thread: t,
        members,
        counterpartLabel,
        lastMessageBody: last ? (last.deleted_at ? '[削除されました]' : last.body) : null,
        lastMessageAt: t.last_message_at,
        unreadCount: unreadByThread.get(t.id) ?? 0,
      };
    });
    summaries.sort((a, b) => (b.lastMessageAt > a.lastMessageAt ? 1 : -1));
    setThreads(summaries);
    setLoadingThreads(false);
  }, [supabase, me]);

  /* --- 個別スレッド読込 --- */
  const loadMessages = useCallback(async (threadId: string) => {
    if (!me) return;
    setLoadingMessages(true);
    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    const ids = (msgs ?? []).map((m) => m.id);
    let attachments: AttachmentInfo[] = [];
    if (ids.length > 0) {
      const { data: atts } = await supabase
        .from('message_attachments')
        .select('id, message_id, file_name, mime_type, storage_path, size_bytes, link_url')
        .in('message_id', ids);
      attachments = (atts ?? []) as (AttachmentInfo & { message_id: string })[];
    }
    type AttWithMsg = AttachmentInfo & { message_id: string };
    const attsByMsg = new Map<string, AttachmentInfo[]>();
    for (const a of attachments as AttWithMsg[]) {
      const arr = attsByMsg.get(a.message_id) ?? [];
      arr.push(a);
      attsByMsg.set(a.message_id, arr);
    }
    const out = (msgs ?? []).map((m: MessageRow) => ({
      ...m,
      attachments: attsByMsg.get(m.id) ?? [],
    }));
    setMessages(out);
    setLoadingMessages(false);
    /* 自分以外が送ったメッセージは未読を既読化 */
    const unreadIds = out
      .filter((m) => m.sender_employee_id !== me.id && !m.deleted_at)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      await supabase
        .from('message_reads')
        .upsert(unreadIds.map((id) => ({ message_id: id, employee_id: me.id })), { onConflict: 'message_id,employee_id' });
      /* バッジ更新のため一覧再ロード + layout の赤バッジに即時反映 */
      void loadThreads();
      notifyBadgeRefresh();
    }
    /* 末尾までスクロール */
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [supabase, me, loadThreads]);

  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    if (activeThreadId) void loadMessages(activeThreadId);
    else setMessages([]);
  }, [activeThreadId, loadMessages]);

  /* --- 添付ファイル選択 --- */
  const handleAttachChange = (files: FileList | File[] | null) => {
    if (!files) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(files)) {
      if (!ATTACH_ALLOWED_MIME.test(f.type)) {
        rejected.push(`${f.name}: 画像 / PDF のみ受付`);
        continue;
      }
      if (f.size > ATTACH_MAX_BYTES) {
        rejected.push(`${f.name}: 10MB を超えています`);
        continue;
      }
      accepted.push(f);
    }
    if (rejected.length > 0) setError(rejected.join(' / '));
    setPendingAttachments((prev) => [...prev, ...accepted]);
  };

  /* --- 送信 --- */
  const sendMessage = async () => {
    if (!me || !activeThreadId) return;
    const body = composerBody.trim();
    if (!body && pendingAttachments.length === 0 && pendingLinks.length === 0) return;
    setSending(true);
    setError('');
    try {
      /* 1. メッセージ INSERT */
      const { data: inserted, error: insErr } = await supabase
        .from('messages')
        .insert({ thread_id: activeThreadId, sender_employee_id: me.id, body })
        .select()
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message ?? '送信に失敗しました');

      /* 2. ファイル添付があればストレージ + attachments テーブル
         Storage キーは ASCII safe (UUID + 拡張子) で生成。元のファイル名は
         file_name に保存して DL 時にこの名前で渡す。 */
      for (const file of pendingAttachments) {
        const path = buildStorageKey(inserted.id, file.name);
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw new Error('添付アップロード失敗: ' + upErr.message);
        const { error: attErr } = await supabase.from('message_attachments').insert({
          message_id: inserted.id,
          file_name: file.name,
          mime_type: file.type,
          storage_path: path,
          size_bytes: file.size,
        });
        if (attErr) throw new Error('添付保存失敗: ' + attErr.message);
      }

      /* 2b. URL リンク添付 (Storage には触らない) */
      for (const link of pendingLinks) {
        const { error: linkErr } = await supabase.from('message_attachments').insert({
          message_id: inserted.id,
          file_name: link.label || link.url,
          link_url: link.url,
        });
        if (linkErr) throw new Error('リンク保存失敗: ' + linkErr.message);
      }

      /* 3. 受信者に🔔通知行を入れる（自分以外の参加者向け） */
      await insertMessageNotifications(supabase, me, activeThreadId, body || '（添付）');

      setComposerBody('');
      setPendingAttachments([]);
      setPendingLinks([]);
      await loadMessages(activeThreadId);
      void loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信エラー');
    } finally {
      setSending(false);
    }
  };

  /* --- メッセージ編集 --- */
  const startEdit = (m: MessageWithAttachments) => {
    setEditingMessageId(m.id);
    setEditingBody(m.body);
  };
  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingBody('');
  };
  const saveEdit = async (id: string) => {
    const newBody = editingBody.trim();
    if (!newBody) return;
    const { error: e } = await supabase
      .from('messages')
      .update({ body: newBody, edited_at: new Date().toISOString() })
      .eq('id', id);
    if (e) {
      setError('編集失敗: ' + e.message);
      return;
    }
    cancelEdit();
    if (activeThreadId) await loadMessages(activeThreadId);
  };

  /* --- メッセージ削除（ソフト） --- */
  const deleteMessage = async (id: string) => {
    if (!confirm('このメッセージを削除しますか？')) return;
    const { error: e } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString(), body: '' })
      .eq('id', id);
    if (e) {
      setError('削除失敗: ' + e.message);
      return;
    }
    if (activeThreadId) await loadMessages(activeThreadId);
    void loadThreads();
  };

  /* --- 添付を開く: link_url なら直接遷移、storage_path なら signed URL --- */
  const openAttachment = async (att: AttachmentInfo) => {
    if (att.link_url) {
      window.open(att.link_url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!att.storage_path) {
      setError('添付情報が不完全です');
      return;
    }
    const { data, error: e } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(att.storage_path, 60);
    if (e || !data) {
      setError('添付の取得に失敗しました');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  if (!me) {
    return <div className="p-6 text-sm text-brand-gray">読み込み中...</div>;
  }

  const canCreateThread = scope === 'admin' || scope === 'manager';

  return (
    <div className="flex flex-col gap-3 -m-6 lg:-m-8 p-4 lg:p-6 h-[calc(100vh-180px)]">
      <div className="flex items-center justify-between flex-wrap gap-3 print-hide">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
          💬 個別連絡
        </h1>
        {canCreateThread && (
          <Button variant="primary" onClick={() => setShowNewThread(true)}>＋ 新規メッセージ</Button>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 rounded text-sm" style={{ background: 'var(--red-pale)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <div className="flex flex-1 gap-3 min-h-0">
        {/* 左: スレッド一覧 — md 未満 + 選択中 は隠す */}
        <aside
          className={`${activeThreadId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 border rounded overflow-hidden`}
          style={{ borderColor: 'var(--rule)', background: 'var(--white)' }}
        >
          <div className="px-3 py-2 text-xs font-bold border-b" style={{ borderColor: 'var(--rule)', background: 'var(--bg)', color: 'var(--ink-2)' }}>
            スレッド ({threads.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingThreads ? (
              <div className="p-3 text-xs text-brand-gray">読み込み中...</div>
            ) : threads.length === 0 ? (
              <div className="p-3 text-xs text-brand-gray">メッセージはまだありません</div>
            ) : (
              <ul className="flex flex-col">
                {threads.map((t) => {
                  const isActive = t.thread.id === activeThreadId;
                  return (
                    <li key={t.thread.id}>
                      <button
                        type="button"
                        onClick={() => setActiveThreadId(t.thread.id)}
                        className={`w-full text-left px-3 py-2 border-b transition-colors hover:bg-[var(--accent-pale)] ${isActive ? 'bg-[var(--accent-pale)]' : ''}`}
                        style={{ borderColor: 'var(--rule)' }}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-sm truncate">{t.counterpartLabel}</span>
                          {t.unreadCount > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand-red text-white text-[10px] font-bold">
                              {t.unreadCount > 99 ? '99+' : t.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-brand-gray-light truncate">
                          {t.lastMessageBody ?? '（メッセージなし）'}
                        </div>
                        <div className="text-[10px] text-brand-gray-light tabular-nums mt-0.5">
                          {format(new Date(t.lastMessageAt), 'M/d HH:mm', { locale: ja })}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* 右: スレッド詳細 */}
        <section
          className={`${activeThreadId ? 'flex' : 'hidden md:flex'} flex-col flex-1 border rounded overflow-hidden min-h-0`}
          style={{ borderColor: 'var(--rule)', background: 'var(--white)' }}
        >
          {!activeThreadId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-brand-gray">
              左のスレッドを選択してください
            </div>
          ) : (
            <>
              {/* ヘッダー */}
              <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--rule)', background: 'var(--bg)' }}>
                <button
                  type="button"
                  onClick={() => setActiveThreadId(null)}
                  className="md:hidden text-sm px-2 py-1 rounded hover:bg-[var(--accent-pale)]"
                  aria-label="一覧に戻る"
                >
                  ← 一覧
                </button>
                <div className="text-sm font-bold">
                  {threads.find((t) => t.thread.id === activeThreadId)?.counterpartLabel ?? ''}
                </div>
              </div>

              {/* メッセージ履歴 */}
              <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" style={{ background: 'var(--bg)' }}>
                {loadingMessages ? (
                  <div className="text-xs text-brand-gray">読み込み中...</div>
                ) : messages.length === 0 ? (
                  <div className="text-xs text-brand-gray">メッセージはまだありません</div>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_employee_id === me.id;
                    const senderName =
                      threads.find((t) => t.thread.id === activeThreadId)?.members.find((p) => p.id === m.sender_employee_id)?.name
                      ?? '（不明）';
                    const isEditing = editingMessageId === m.id;
                    return (
                      <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                        <div className="text-[10px] text-brand-gray-light mb-0.5">
                          {senderName} · {format(new Date(m.created_at), 'M/d HH:mm', { locale: ja })}
                          {m.edited_at && <span className="ml-1">（編集済）</span>}
                        </div>
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 ${mine ? 'bg-brand-blue text-white' : 'bg-white border'}`}
                          style={{ borderColor: mine ? undefined : 'var(--rule)' }}
                        >
                          {m.deleted_at ? (
                            <span className="text-xs italic" style={{ color: mine ? 'rgba(255,255,255,0.7)' : 'var(--ink-3)' }}>
                              [削除されました]
                            </span>
                          ) : isEditing ? (
                            <div className="flex flex-col gap-2 min-w-[200px]">
                              <textarea
                                value={editingBody}
                                onChange={(e) => setEditingBody(e.target.value)}
                                rows={2}
                                className="text-sm rounded p-2 outline-none text-brand-ink"
                                style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                              />
                              <div className="flex gap-2">
                                <button onClick={() => saveEdit(m.id)} className="text-xs px-2 py-1 rounded bg-emerald-500 text-white">保存</button>
                                <button onClick={cancelEdit} className="text-xs px-2 py-1 rounded bg-gray-400 text-white">取消</button>
                              </div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap text-sm break-words">{m.body}</div>
                          )}
                          {/* 添付 */}
                          {!m.deleted_at && m.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {m.attachments.map((a) => {
                                const icon = a.link_url
                                  ? '🔗'
                                  : a.mime_type === 'application/pdf' ? '📄' : '🖼️';
                                const title = a.link_url
                                  ? a.link_url
                                  : `${a.file_name}${a.size_bytes ? ` (${(a.size_bytes / 1024).toFixed(0)}KB)` : ''}`;
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => openAttachment(a)}
                                    className={`text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 max-w-[280px] ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-brand-blue/5 hover:bg-brand-blue/10 text-brand-ink'}`}
                                    title={title}
                                  >
                                    {icon} <span className="truncate">{a.file_name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {mine && !m.deleted_at && !isEditing && (
                          <div className="flex gap-1 mt-1 text-[10px]">
                            <button onClick={() => startEdit(m)} className="text-brand-blue hover:underline">編集</button>
                            <span className="text-brand-gray-light">·</span>
                            <button onClick={() => deleteMessage(m.id)} className="text-brand-red hover:underline">削除</button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* 入力欄 */}
              <div className="border-t px-3 py-2 flex flex-col gap-2" style={{ borderColor: 'var(--rule)' }}>
                {(pendingAttachments.length > 0 || pendingLinks.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {pendingAttachments.map((f, i) => (
                      <span key={`f${i}`} className="text-[11px] px-2 py-1 rounded bg-brand-beige inline-flex items-center gap-1">
                        {f.type === 'application/pdf' ? '📄' : '🖼️'} {f.name} ({(f.size / 1024).toFixed(0)}KB)
                        <button
                          onClick={() => setPendingAttachments((p) => p.filter((_, j) => j !== i))}
                          className="ml-1 text-brand-red"
                          aria-label="削除"
                        >×</button>
                      </span>
                    ))}
                    {pendingLinks.map((l, i) => (
                      <span key={`l${i}`} className="text-[11px] px-2 py-1 rounded bg-brand-blue/[0.08] text-brand-blue inline-flex items-center gap-1 max-w-[280px]">
                        🔗 <span className="truncate">{l.label || l.url}</span>
                        <button
                          onClick={() => setPendingLinks((p) => p.filter((_, j) => j !== i))}
                          className="ml-1 text-brand-red"
                          aria-label="削除"
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <textarea
                    value={composerBody}
                    onChange={(e) => setComposerBody(e.target.value)}
                    placeholder="メッセージを入力..."
                    rows={2}
                    className="flex-1 text-sm rounded p-2 outline-none"
                    style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                  />
                  <Button variant="primary" onClick={sendMessage} disabled={sending || (!composerBody.trim() && pendingAttachments.length === 0 && pendingLinks.length === 0)}>
                    {sending ? '送信中...' : '送信'}
                  </Button>
                </div>
                <LinkAddInline onAdd={(url, label) => setPendingLinks((p) => [...p, { url, label }])} />
                <AttachmentDropZone
                  compact
                  acceptMime="image/*,application/pdf"
                  maxBytesLabel="10MB"
                  helperText="画像 / PDF、各 10MB まで (クリック / ドラッグ&ドロップ / 貼り付け)"
                  onFiles={handleAttachChange}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {/* 新規スレッドダイアログ */}
      {canCreateThread && showNewThread && (
        <NewThreadDialog
          me={me}
          scope={scope}
          presetRecipientId={presetRecipientId}
          onCancel={() => setShowNewThread(false)}
          onCreated={async (newThreadId) => {
            setShowNewThread(false);
            await loadThreads();
            setActiveThreadId(newThreadId);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   新規スレッド作成ダイアログ
   ============================================================ */
interface NewThreadDialogProps {
  me: MeRow;
  scope: Scope;
  presetRecipientId?: string | null;
  onCancel: () => void;
  onCreated: (threadId: string) => Promise<void>;
}

function NewThreadDialog({ me, scope, presetRecipientId, onCancel, onCreated }: NewThreadDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const [candidates, setCandidates] = useState<EmployeePick[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(presetRecipientId ? [presetRecipientId] : []);
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  /* 178: 外部 URL リンク添付 */
  const [links, setLinks] = useState<{ url: string; label: string }[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  /* 候補社員一覧をロード（manager は自管轄施設のみ） */
  const loadCandidates = useCallback(async () => {
    setLoading(true);
    let allowedFacilityIds: string[] = [];
    if (scope === 'manager') {
      const my: string[] = [];
      if (me.facility_id) my.push(me.facility_id);
      const { data: mfs } = await supabase
        .from('manager_facilities')
        .select('facility_id')
        .eq('employee_id', me.id);
      for (const f of mfs ?? []) my.push(f.facility_id);
      allowedFacilityIds = Array.from(new Set(my));
    }

    let memberIds: string[] | null = null;
    if (scope === 'manager') {
      memberIds = await fetchEmployeeIdsForFacilities(supabase, allowedFacilityIds);
    }

    let query = supabase
      .from('employees')
      .select('id, employee_number, last_name, first_name, facility_id, status, role')
      .eq('tenant_id', me.tenant_id)
      .eq('status', 'active')
      .neq('id', me.id)
      .neq('role', 'shift_manager'); /* シフト統括は個別連絡の宛先候補から除外 */
    if (memberIds !== null) {
      query = query.in('id', memberIds.length > 0 ? memberIds : ['00000000-0000-0000-0000-000000000000']);
    }

    const { data } = await query;
    /* 従業員番号順 (数値変換できれば数値比較、それ以外は文字列比較、未設定 (NULL/空) は末尾) */
    const sorted = ((data ?? []) as Array<{ id: string; employee_number: string | null; last_name: string | null; first_name: string | null; facility_id: string | null }>)
      .slice()
      .sort((a, b) => {
        const an = String(a.employee_number ?? '').trim();
        const bn = String(b.employee_number ?? '').trim();
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        const aNum = Number(an);
        const bNum = Number(bn);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
        return an.localeCompare(bn, 'ja');
      });
    setCandidates(
      sorted.map((e) => ({
        id: e.id,
        name: staffDisplayName({ last_name: e.last_name, first_name: e.first_name }),
        facility_id: e.facility_id,
      })),
    );
    setLoading(false);
  }, [supabase, me, scope]);

  useEffect(() => { void loadCandidates(); }, [loadCandidates]);

  const filtered = useMemo(() => {
    const q = filter.trim();
    if (!q) return candidates;
    return candidates.filter((c) => c.name.includes(q));
  }, [candidates, filter]);

  const handleAttach = (files: FileList | File[] | null) => {
    if (!files) return;
    const out: File[] = [];
    const reject: string[] = [];
    for (const f of Array.from(files)) {
      if (!ATTACH_ALLOWED_MIME.test(f.type)) { reject.push(`${f.name}: 画像/PDF のみ`); continue; }
      if (f.size > ATTACH_MAX_BYTES) { reject.push(`${f.name}: 10MB 超`); continue; }
      out.push(f);
    }
    if (reject.length > 0) setErr(reject.join(' / '));
    setAttachments((p) => [...p, ...out]);
  };

  const submit = async () => {
    if (selectedIds.length === 0) { setErr('宛先を 1 名以上選んでください'); return; }
    if (!body.trim() && attachments.length === 0 && links.length === 0) { setErr('本文または添付を入力してください'); return; }
    setSubmitting(true);
    setErr('');

    /* 観測ログ: docs/error-log.md 「manager 個別送信スレッド作成で RLS 違反 (未解決)」事案
       (2026-05-26 / ORIGAMI 経由で diletto に発覚し deaf-ic にも観測コード移植)
       の再現時に F12 console で真因を特定するため、各 step で
       supabase エラーの code/details/hint と me/auth セッション状態を出力する。
       「new row violates row-level security policy」が再発したら、ここの出力
       (特に authUid が null / me.tenant_id が undefined) から真因を逆引きする。 */
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const debugCtx = {
      scope,
      authUid: authUser?.id ?? null,
      meId: me?.id,
      meTenantId: me?.tenant_id,
      meRole: me?.role,
      recipients: selectedIds,
      attachCount: attachments.length,
      linkCount: links.length,
    };
    console.info('[messages submit] start', debugCtx);
    if (!authUser?.id) {
      console.error('[messages submit] FATAL: authUser is null (セッション失効疑い)', debugCtx);
    }
    if (!me?.tenant_id) {
      console.error('[messages submit] FATAL: me.tenant_id is empty', debugCtx);
    }

    try {
      /* 1. スレッド作成
         ⚠ INSERT 後の .select().single() は PostgreSQL の RETURNING 仕様で
         SELECT policy にも合致しないと弾かれ 403 になる (自分が member 追加前は
         message_threads_select の is_message_thread_member が false → 403)。
         クライアント側で UUID を事前生成して RETURNING を回避する。 */
      const threadId = crypto.randomUUID();
      const { error: tErr } = await supabase
        .from('message_threads')
        .insert({ id: threadId, tenant_id: me.tenant_id });
      if (tErr) {
        console.error('[messages submit] step1 message_threads INSERT failed', { ...debugCtx, threadId, error: tErr });
        throw new Error(tErr.message);
      }

      /* 2. 参加者: 自分 + 受信者 */
      const memberRows = [me.id, ...selectedIds].map((eid) => ({ thread_id: threadId, employee_id: eid }));
      const { error: mErr } = await supabase.from('message_thread_members').insert(memberRows);
      if (mErr) {
        console.error('[messages submit] step2 message_thread_members INSERT failed', { ...debugCtx, threadId, memberRows, error: mErr });
        throw new Error(mErr.message);
      }

      /* 3. 最初のメッセージ。同じ理由で UUID を事前生成 (message_id 後段で使う) */
      const messageId = crypto.randomUUID();
      const { error: msgErr } = await supabase
        .from('messages')
        .insert({ id: messageId, thread_id: threadId, sender_employee_id: me.id, body: body.trim() });
      if (msgErr) {
        console.error('[messages submit] step3 messages INSERT failed', { ...debugCtx, threadId, messageId, error: msgErr });
        throw new Error(msgErr.message);
      }

      /* 4a. ファイル添付。Storage キーは ASCII safe (UUID + 拡張子) で生成 */
      for (const file of attachments) {
        const path = buildStorageKey(messageId, file.name);
        const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type });
        if (upErr) throw new Error('添付アップロード失敗: ' + upErr.message);
        await supabase.from('message_attachments').insert({
          message_id: messageId,
          file_name: file.name,
          mime_type: file.type,
          storage_path: path,
          size_bytes: file.size,
        });
      }

      /* 4b. URL リンク添付 */
      for (const link of links) {
        const { error: linkErr } = await supabase.from('message_attachments').insert({
          message_id: messageId,
          file_name: link.label || link.url,
          link_url: link.url,
        });
        if (linkErr) throw new Error('リンク保存失敗: ' + linkErr.message);
      }

      /* 5. 受信者に🔔通知 */
      await insertMessageNotifications(supabase, me, threadId, body.trim() || '（添付）');

      await onCreated(threadId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '送信失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--rule)' }}>
          <h2 className="text-base font-bold">新規メッセージ</h2>
          <button onClick={onCancel} className="text-brand-gray hover:text-brand-ink">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {err && <div className="px-3 py-2 rounded text-xs" style={{ background: 'var(--red-pale)', color: 'var(--red)' }}>{err}</div>}

          <div>
            <label className="text-xs font-bold mb-1 block" style={{ color: 'var(--ink-2)' }}>宛先（1 名以上 / 複数可）</label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="名前で絞り込み"
              className="w-full text-sm rounded px-2 py-1 outline-none mb-2"
              style={{ border: '1px solid var(--rule)' }}
            />
            <div className="max-h-48 overflow-y-auto rounded border" style={{ borderColor: 'var(--rule)' }}>
              {loading ? (
                <div className="p-2 text-xs text-brand-gray">読み込み中...</div>
              ) : filtered.length === 0 ? (
                <div className="p-2 text-xs text-brand-gray">該当する社員がいません</div>
              ) : (
                <ul>
                  {filtered.map((c) => {
                    const checked = selectedIds.includes(c.id);
                    return (
                      <li key={c.id}>
                        <label className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-[var(--accent-pale)] ${checked ? 'bg-[var(--accent-pale)]' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedIds((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])}
                          />
                          <span className="text-sm">{c.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>選択中: {selectedIds.length} 名</div>
          </div>

          <div>
            <label className="text-xs font-bold mb-1 block" style={{ color: 'var(--ink-2)' }}>本文</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="メッセージを入力..."
              className="w-full text-sm rounded p-2 outline-none"
              style={{ border: '1px solid var(--rule)' }}
            />
          </div>

          <div>
            <label className="text-xs font-bold mb-1 block" style={{ color: 'var(--ink-2)' }}>添付</label>
            <AttachmentDropZone
              acceptMime="image/*,application/pdf"
              maxBytesLabel="10MB"
              onFiles={handleAttach}
            />
            {(attachments.length > 0 || links.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {attachments.map((f, i) => (
                  <span key={`f${i}`} className="text-[11px] px-2 py-1 rounded bg-brand-beige inline-flex items-center gap-1">
                    {f.type === 'application/pdf' ? '📄' : '🖼️'} {f.name}
                    <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="ml-1 text-brand-red">×</button>
                  </span>
                ))}
                {links.map((l, i) => (
                  <span key={`l${i}`} className="text-[11px] px-2 py-1 rounded bg-brand-blue/[0.08] text-brand-blue inline-flex items-center gap-1 max-w-[280px]">
                    🔗 <span className="truncate">{l.label || l.url}</span>
                    <button onClick={() => setLinks((p) => p.filter((_, j) => j !== i))} className="ml-1 text-brand-red">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2">
              <LinkAddInline onAdd={(url, label) => setLinks((p) => [...p, { url, label }])} />
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--rule)' }}>
          <Button variant="secondary" onClick={onCancel}>キャンセル</Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? '送信中...' : '送信'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   URL リンク添付 追加 inline UI
   ============================================================ */
function LinkAddInline({ onAdd }: { onAdd: (url: string, label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState('');

  function handleAdd() {
    const u = url.trim();
    if (!u) { setErr('URL を入力してください'); return; }
    if (!/^https?:\/\//i.test(u)) { setErr('URL は http:// または https:// で始めてください'); return; }
    onAdd(u, label.trim());
    setUrl('');
    setLabel('');
    setErr('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-[11px] text-brand-blue hover:underline inline-flex items-center gap-1"
      >
        🔗 URL リンクを貼る (PDF / 動画 / Google Drive 等)
      </button>
    );
  }

  return (
    <div className="border rounded-md p-2 space-y-1 bg-brand-blue/[0.03]" style={{ borderColor: 'var(--rule)' }}>
      <input
        type="url"
        placeholder="https://..."
        value={url}
        onChange={(e) => { setUrl(e.target.value); setErr(''); }}
        className="w-full text-xs px-2 py-1 rounded border bg-white"
        style={{ borderColor: 'var(--rule)' }}
      />
      <input
        type="text"
        placeholder="表示名 (任意)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="w-full text-xs px-2 py-1 rounded border bg-white"
        style={{ borderColor: 'var(--rule)' }}
      />
      {err && <p className="text-[11px] text-brand-red">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => { setOpen(false); setUrl(''); setLabel(''); setErr(''); }}
          className="text-[11px] text-brand-gray hover:underline"
        >キャンセル</button>
        <button
          type="button"
          onClick={handleAdd}
          className="text-[11px] text-brand-blue font-bold hover:underline"
        >+ 追加</button>
      </div>
    </div>
  );
}
