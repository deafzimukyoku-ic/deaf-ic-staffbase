/**
 * 通知イベントコード定義（deaf-ic）。共通仕様 push-notifications-v2.md §3 のカタログ。
 */

export const NOTIFICATION_EVENTS = {
  PUBLISH_NEW: 'publish_new',
  PUBLISH_IMPORTANT_UPDATE: 'publish_important_update',
  ENGAGEMENT_DAILY_DIGEST: 'engagement_daily_digest',
  UNREAD_REMINDER_MANUAL: 'unread_reminder_manual',
  TRAINING_RESULT: 'training_result',
  // deaf-ic 固有（既存維持）
  ISSUED_DOCUMENT: 'issued_document',
  MANAGER_ACTION: 'manager_action',
} as const;

export type NotificationEventCode = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export const PUBLISH_CONTENT_META = {
  announcement: { label: 'お知らせ', urlPath: '/my/announcements', table: 'announcements' },
  compliance: { label: '遵守事項', urlPath: '/my/compliance', table: 'compliance_documents' },
  training: { label: '研修', urlPath: '/my/trainings', table: 'trainings' },
  manual: { label: '業務マニュアル', urlPath: '/my/manuals', table: 'manuals' },
} as const;

export type PublishContentType = keyof typeof PUBLISH_CONTENT_META;

export const TRAINING_RESULT_LABELS = {
  passed: '合格',
  failed: '不合格',
  resubmit: '再提出',
} as const;

export type TrainingResultValue = keyof typeof TRAINING_RESULT_LABELS;

export const UNREAD_REMINDER_CATEGORIES = {
  announcements: { label: 'お知らせ', urlPath: '/my/announcements' },
  compliance: { label: '遵守事項', urlPath: '/my/compliance' },
  training: { label: '研修', urlPath: '/my/trainings' },
  manuals: { label: '業務マニュアル', urlPath: '/my/manuals' },
  documents: { label: '書類', urlPath: '/my/documents' },
} as const;

export type UnreadReminderCategory = keyof typeof UNREAD_REMINDER_CATEGORIES;
