import type { CustomRole, BoardColumn } from './types';

export const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' }
];

export const getDefaultRoles = (t18n: any): CustomRole[] => [
  { id: 'client', label: t18n("legacy.customer_po"), color: 'amber', badge: '👑' },
  { id: 'developer', label: t18n("legacy.developer"), color: 'indigo', badge: '🤖' },
  { id: 'qa', label: t18n("legacy.tester_qa"), color: 'emerald', badge: '🧪' },
  { id: 'designer', label: t18n("legacy.designer_ui"), color: 'pink', badge: '🎨' },
  { id: 'devops', label: t18n("legacy.devops_infra"), color: 'cyan', badge: '⚙️' }
];

export const getDefaultColumns = (t18n: any): BoardColumn[] => [
  { id: 'backlog', label: t18n("legacy.backlog"), color: 'slate' },
  { id: 'in_progress', label: t18n("legacy.in_progress"), color: 'amber' },
  { id: 'review', label: t18n("legacy.review_qa"), color: 'indigo' },
  { id: 'done', label: t18n("legacy.done"), color: 'emerald' }
];
