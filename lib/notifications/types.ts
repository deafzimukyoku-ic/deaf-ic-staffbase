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
  | 'manual_read';

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
};
