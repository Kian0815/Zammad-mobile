export type ViewKey = 'allActive' | 'myAssigned' | 'newTickets' | 'openTickets' | 'waitingCustomer' | 'pendingAutoclose' | 'processing';

export type Session = {
  username: string;
  defaultOwnerId: number;
  readOnlyMode: boolean;
};

export type TicketCard = {
  id: number;
  number: string;
  title: string;
  queue_key: string;
  queue_label: string;
  customer: string;
  state: string;
  priority: string;
  owner: string;
  updated_at: string;
  escalation_at?: string | null;
  owner_id: number | null;
  customer_id: number | null;
  organization_id: number | null;
  state_id: number;
  priority_id: number;
  is_new?: boolean;
  sla_customer?: string | null;
  first_response_escalation_at?: string | null;
  update_escalation_at?: string | null;
  close_escalation_at?: string | null;
};

export type TicketView = {
  key: ViewKey;
  label: string;
  tickets: TicketCard[];
};

export type TicketViewsResponse = {
  generatedAt: string;
  search: string;
  queue: string;
  sort: string;
  views: Record<ViewKey, TicketView>;
};

export type LookupOption = {
  id: number;
  name: string;
};

export type OwnerOption = {
  id: number;
  label: string;
};

export type QueueOption = {
  key: string;
  label: string;
};

export type WorkflowMacroOption = {
  key: string;
  id: number;
  label: string;
};

export type PushConfig = {
  enabled: boolean;
  publicKey: string | null;
};

export type LookupsResponse = {
  states: LookupOption[];
  priorities: LookupOption[];
  owners: OwnerOption[];
  defaultOwnerId: number;
  queues: QueueOption[];
  workflowMacros: WorkflowMacroOption[];
};

export type ArticleAttachment = {
  id: number;
  filename: string;
  size: string;
  preferences?: Record<string, string>;
};

export type TicketArticle = {
  id: number;
  ticket_id: number;
  subject: string | null;
  body: string;
  internal: boolean;
  type: string;
  sender: string;
  from?: string | null;
  to?: string | null;
  cc?: string | null;
  created_at: string;
  created_by: string;
  attachments: ArticleAttachment[];
  created_by_user?: {
    id: number;
    fullname?: string;
    email?: string;
  } | null;
};

export type TicketDetail = {
  id: number;
  number: string;
  title: string;
  state_id: number;
  state_name: string;
  priority_id: number;
  priority_name: string;
  owner_id: number | null;
  owner: {
    id: number;
    fullname?: string;
    email?: string;
  } | null;
  customer: {
    id: number;
    fullname?: string;
    email?: string;
  } | null;
  organization_id?: number | null;
  sla_customer?: string | null;
  updated_at: string;
  escalation_at?: string | null;
  first_response_escalation_at?: string | null;
  update_escalation_at?: string | null;
  close_escalation_at?: string | null;
  reply_recipients?: {
    to: string | null;
    cc: string[];
    source_article_id: number | null;
  };
  articles: TicketArticle[];
};
