export type PageResponse<T> = {
  items: T[];
  total: number;
  page: number;
  size: number;
};

export type DlrWebhook = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
};

export type Partner = {
  id: number;
  code: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  dlr_webhook: DlrWebhook | null;
  balance: number;
  created_at: string;
  updated_at: string;
};

export type PartnerSmppAccount = {
  id: number;
  partner_id: number;
  system_id: string;
  max_binds: number;
  ip_whitelist: string[];
  status: "ACTIVE" | "DISABLED";
  created_at: string;
};

export type PartnerApiKey = {
  id: number;
  key_id: string;
  label: string;
  status: "ACTIVE" | "REVOKED";
  last_used_at: string | null;
  created_at: string;
};

export type DeliveryType = "SMS" | "VOICE_OTP";
export type RateUnit = "MESSAGE" | "SECOND" | "CALL";
export type Carrier = "VIETTEL" | "MOBIFONE" | "VINAPHONE" | "VIETNAMOBILE" | "GMOBILE" | "REDDI";

export type CarrierInfo = {
  code: Carrier;
  name: string;
  prefixes: string[];
};

export type ChannelType = "HTTP_THIRD_PARTY" | "FREESWITCH_ESL" | "TELCO_SMPP";
export type ChannelStatus = "ACTIVE" | "DISABLED";

export type Channel = {
  id: number;
  code: string;
  name: string;
  type: ChannelType;
  delivery_type: DeliveryType;
  config: Record<string, unknown>;
  status: ChannelStatus;
  created_at: string;
  updated_at: string;
};

export type ChannelRate = {
  id: number;
  channel_id: number;
  carrier: Carrier | null;
  prefix: string;
  rate: number;
  currency: string;
  unit: RateUnit;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export type PartnerRate = {
  id: number;
  partner_id: number;
  delivery_type: DeliveryType;
  carrier: Carrier | null;
  prefix: string;
  rate: number;
  currency: string;
  unit: RateUnit;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export type ChannelStats = {
  period: string;
  total: number;
  delivered: number;
  failed: number;
  delivery_rate: number;
  by_state: Record<string, number>;
};

export type HttpProviderField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  hint: string | null;
};

export type HttpProvider = {
  code: string;
  name: string;
  delivery_type: DeliveryType;
  fields: HttpProviderField[];
};

export type Route = {
  id: number;
  partner_id: number;
  carrier: string | null;
  msisdn_prefix: string;
  channel_id: number;
  fallback_channel_id: number | null;
  priority: number;
  enabled: boolean;
  created_at: string;
};

export type MessageState = "RECEIVED" | "ROUTED" | "SUBMITTED" | "DELIVERED" | "FAILED";

export type Message = {
  id: string;
  partner_id: number;
  channel_id: number | null;
  source_addr: string;
  dest_addr: string;
  content: string;
  encoding: "GSM7" | "UCS2" | "LATIN1";
  inbound_via: "SMPP" | "HTTP";
  state: MessageState;
  message_id_telco: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminRole = "ADMIN" | "PARTNER";

export type AdminUser = {
  id: number;
  username: string;
  role: AdminRole;
  partner_id: number | null;
  enabled: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type StatsOverview = Record<MessageState, number>;

export type TimeseriesPoint = {
  bucket: string;
  state: MessageState;
  count: number;
};

export type TimeseriesResponse = {
  granularity: "hour" | "day";
  from: string;
  to: string;
  series: TimeseriesPoint[];
};

export type SmppSession = {
  session_id: string;
  system_id: string;
  bind_type: string;
  remote_ip: string;
  bound_at: string;
};
