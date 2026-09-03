export interface Checklist {
  [key: string]: boolean | undefined;
}

export interface BugContext {
  type?: 'ui' | 'backend' | 'logic' | undefined;
  url?: string | undefined;
  selector?: string | undefined;
  elementText?: string | undefined;
  viewport?: string | undefined;
  screen?: string | undefined;
  os?: string | undefined;
  browser?: string | undefined;
  dpr?: number | undefined;
  isTouch?: boolean | undefined;
  orientation?: 'portrait' | 'landscape' | undefined;
  lang?: string | undefined;
  connection?: string | undefined;
  userAgent?: string | undefined;
  apiEndpoint?: string | undefined;
  httpStatus?: string | undefined;
  requestPayload?: string | undefined;
  responseTraceback?: string | undefined;
  logs?: string | undefined;
  xpath?: string | undefined;
}

export interface Ticket {
  id: string;
  key?: string | undefined;
  node_id?: string | undefined;
  board_id?: string | undefined;
  title: string;
  summary: string;
  source_quote?: string | undefined;
  assignee?: string | undefined;
  status: string;
  priority: 'high' | 'medium' | 'low' | 'critical' | string;
  order: number;
  checklists: Checklist;
  criteria_contract?: Record<string, any> | undefined;
  criteria_evidence?: Record<string, any> | undefined;
  quality_mode?: 'standard' | 'strict' | 'critical' | undefined;
  rework_notes?: string | undefined;
  bug_context?: BugContext | undefined;
  comments?: Array<{ id: string; author?: string | undefined; text: string; date?: string | undefined; created_at?: string | undefined }> | undefined;
  is_archived?: boolean | undefined;
  revision?: number | undefined;
  github_issue_url?: string | undefined;
  github_issue_number?: number | undefined;
  deadline?: string | undefined;
  tags?: string[] | undefined;
  estimate?: string | undefined;
}

export interface DiscussionComment {
  id: string;
  author: string;
  text: string;
  date: string;
}

export interface DiscussionThread {
  id: string;
  quote: string;
  status?: 'active' | 'resolved' | undefined;
  resolved?: boolean | undefined;
  created_ticket_ids?: string[] | undefined;
  comments: DiscussionComment[];
}

export interface NodeItem {
  id: string;
  parent_id?: string | null | undefined;
  title: string;
  description?: string | undefined;
  content_markdown?: string | undefined;
  discussions?: DiscussionThread[] | undefined;
  tickets: Ticket[];
}

export interface BoardColumn {
  id: string;
  label: string;
  color: string;
}

export interface CustomRole {
  id: string;
  label: string;
  color: string;
  badge: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  tg_username?: string | undefined;
  tg_chat_id?: string | undefined;
}

export interface PublicFeedback {
  id: string;
  author: string;
  contact?: string | undefined;
  text: string;
  quote?: string | undefined;
  created_at: string;
  status: 'new' | 'converted';
  dom_context?: { url: string; element_html: string } | undefined;
  converted_ticket_id?: string | undefined;
}

export interface GroupChatConfig {
  chat_id?: string | undefined;
  title?: string | undefined;
  notify_review?: boolean | undefined;
  notify_rework?: boolean | undefined;
  notify_feedback?: boolean | undefined;
  notify_discussions?: boolean | undefined;
}

export interface CustomBoard {
  id: string;
  title: string;
  description?: string | undefined;
  filter_tag?: string | undefined;
}

export interface BoardData {
  project_id: string;
  subscription_tier?: 'free' | 'pro' | 'team' | 'enterprise' | string | undefined;
  access_mode?: 'studio' | 'public_feedback' | 'client_preview' | undefined;
  columns?: BoardColumn[] | undefined;
  custom_roles?: CustomRole[] | undefined;
  custom_boards?: CustomBoard[] | undefined;
  boards?: CustomBoard[] | undefined;
  group_chat?: GroupChatConfig | undefined;
  telemetry_enabled?: boolean | undefined;
  ai_data_sharing?: boolean | undefined;
  subscribers?: TeamMember[] | undefined;
  feedbacks?: PublicFeedback[] | undefined;
  nodes: NodeItem[];
}

export interface VibusWidgetProps {
  projectId?: string | undefined;
  serverUrl?: string | undefined;
  apiToken?: string | undefined;
  publicKey?: string | undefined;
  initialBoardData?: BoardData | null | undefined;
  theme?: 'dark' | 'light' | 'auto' | undefined;
  accentColor?: string | undefined;
  mode?: 'studio' | 'public_feedback' | 'client_preview' | undefined;
}
