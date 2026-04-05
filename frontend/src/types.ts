export type ViewKey = 'myOpen' | 'unassigned' | 'waitingCustomer' | 'escalated';

export type Session = {
  username: string;
  defaultOwnerId: number;
  readOnlyMode: boolean;
};

export type TicketCard = {
  id: number;
  number: string;
  title: string;
  customer: string;
  state: string;
  priority: string;
  owner: string;
  updated_at: string;
  escalation_at?: string | null;
  owner_id: number | null;
  customer_id: number | null;
  state_id: number;
  priority_id: number;
};

export type TicketView = {
  key: ViewKey;
  label: string;
  tickets: TicketCard[];
};

export type TicketViewsResponse = {
  generatedAt: string;
  search: string;
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

export type LookupsResponse = {
  states: LookupOption[];
  priorities: LookupOption[];
  owners: OwnerOption[];
  defaultOwnerId: number;
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
  updated_at: string;
  escalation_at?: string | null;
  articles: TicketArticle[];
};
