// iLink Bot API types (based on Tencent/openclaw-weixin protocol)

export enum MessageType {
  NONE = 0,
  USER = 1,
  BOT = 2,
}

export enum MessageState {
  NEW = 0,
  GENERATING = 1,
  FINISH = 2,
}

export enum MessageItemType {
  NONE = 0,
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5,
}

export interface TextItem {
  text: string;
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface ImageItem {
  image_url?: { cdn_media?: CDNMedia };
  media?: CDNMedia;
  aeskey?: string;
  mid_size?: number;
}

export interface VoiceItem {
  text?: string;
}

export interface FileItem {
  file_url?: { cdn_media?: CDNMedia };
  media?: CDNMedia;
  file_name?: string;
  len?: string;
  md5?: string;
}

export interface VideoItem {
  video_url?: { cdn_media?: CDNMedia };
  video_size?: number;
}

export interface MessageItem {
  type?: MessageItemType;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: MessageType;
  message_state?: MessageState;
  item_list?: MessageItem[];
  context_token?: string;
}

// API response types

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  msg_list?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageRequest {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: MessageType;
    message_state: MessageState;
    item_list?: MessageItem[];
    context_token?: string;
  };
}

export interface GetConfigResponse {
  ret?: number;
  typing_ticket?: string;
}

export interface AccountData {
  ilink_bot_id: string;
  bot_token: string;
  baseurl: string;
  ilink_user_id?: string;
}

export interface QRCodeResponse {
  ret?: number;
  qrcode?: string;
  qrcode_url?: string;
  errmsg?: string;
}

export interface QRStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  time: number;
}

export interface AppConfig {
  allowedUsers?: string[];
  claudePath?: string;
  claudeArgs?: string[];
  claudeCwd?: string;
  maxResponseLength?: number;
  messageChunkSize?: number;
  typingIndicator?: boolean;
  enableFileUpload?: boolean;
  logLevel?: "error" | "info" | "debug";
  downloadDir?: string;
}

export interface GetUploadUrlRequest {
  filekey: string;
  media_type: number;
  to_user_id: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  no_need_thumb: boolean;
  aeskey: string;
}

export interface GetUploadUrlResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_full_url?: string;
  upload_param?: string;
  filekey?: string;
}

export interface CdnUploadResult {
  encryptedQueryParam: string;
  aesKeyEncoded: string;
  rawSize: number;
  fileSize: number;
  md5: string;
  fileKey: string;
}
