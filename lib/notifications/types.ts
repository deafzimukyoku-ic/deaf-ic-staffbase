/**
 * 完了通知 (migration 139)
 *
 * 5 種のアクションが起きた時に admin / 該当 manager 宛に自動 INSERT される。
 */

export type NotificationEventType =
  | 'document_submission'
  | 'compliance_ack'
  | 'training_submission'
  | 'announcement_read'
  | 'manual_read'
  /* Phase G / migration 142: 個別メッセージを受信したとき、受信者に向けて挿入される */
  | 'direct_message'
  /* 173: 会社→社員 書類発行 (issued_documents) — 発行先社員に届く通知 */
  | 'document_issued';

/* 未知 event_type が来ても落ちないための fallback メタ。万が一 DB に enum が
   増えたが UI 側 EVENT_META 更新を忘れた場合のための保険。 */
export const FALLBACK_EVENT_META = {
  label: '通知',
  icon: '🔔',
  verb: '',
  href: () => '/admin/dashboard',
} as const;

export interface NotificationRow {
  id: string;
  tenant_id: string;
  recipient_employee_id: string;
  actor_employee_id: string | null;
  actor_name: string | null;
  actor_facility_name: string | null;
  event_type: NotificationEventType;
  event_target_id: string | null;
  event_target_title: string | null;
  read_at: string | null;
  created_at: string;
}

/* イベント別の表示メタ。アイコン・色・「〜を完了」文言。 */
export const EVENT_META: Record<
  NotificationEventType,
  { label: string; icon: string; verb: string; href: (id: string | null) => string }
> = {
  document_submission: {
    label: '書類提出',
    icon: '📄',
    verb: 'を提出しました',
    href: () => '/admin/employees',
  },
  compliance_ack: {
    label: '遵守事項',
    icon: '✅',
    verb: 'を確認しました',
    href: (id) => (id ? `/admin/compliance/${id}` : '/admin/compliance'),
  },
  training_submission: {
    label: '研修',
    icon: '📚',
    verb: 'を提出しました',
    href: (id) => (id ? `/admin/trainings/${id}/submissions` : '/admin/trainings'),
  },
  announcement_read: {
    label: 'お知らせ',
    icon: '📢',
    verb: 'を既読にしました',
    href: (id) => (id ? `/admin/announcements/${id}` : '/admin/announcements'),
  },
  manual_read: {
    label: '業務マニュアル',
    icon: '📖',
    verb: 'を既読にしました',
    href: (id) => (id ? `/admin/manuals/${id}` : '/admin/manuals'),
  },
  direct_message: {
    label: '個別連絡',
    icon: '💬',
    verb: 'からメッセージが届きました',
    /* id にはスレッド ID を入れて、admin / mgr / employee それぞれのスレッド一覧に飛ぶ。
       ここでは admin 向けにフォールバック。実際のリンクは bell 側で role に応じて切替えても良い。 */
    href: () => '/admin/messages',
  },
  document_issued: {
    /* 173: 発行先 (= 社員本人) が受信。admin/manager 自身に発行された場合のみここに出る。 */
    label: '会社発行書類',
    icon: '📨',
    verb: 'が届きました',
    href: () => '/my/documents',
  },
};
