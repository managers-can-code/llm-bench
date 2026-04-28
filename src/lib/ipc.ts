import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Model,
  Conversation,
  Message,
  GenOpts,
  TokenChunk,
  DownloadProgress,
  RuntimeId,
} from "./types";

/* ---------- models / registry ---------- */

export const listModels = (): Promise<Model[]> => invoke("list_models");

export const downloadModel = (
  modelId: string,
  runtime: RuntimeId,
): Promise<void> =>
  invoke("download_model", { modelId, runtime });

export const deleteLocalModel = (
  modelId: string,
  runtime: RuntimeId,
): Promise<void> =>
  invoke("delete_local_model", { modelId, runtime });

export const onDownloadProgress = (
  cb: (p: DownloadProgress) => void,
): Promise<UnlistenFn> => listen<DownloadProgress>("model:download", (e) => cb(e.payload));

/* ---------- conversations ---------- */

export const listConversations = (): Promise<Conversation[]> =>
  invoke("list_conversations");

export const createConversation = (
  modelId: string,
  runtime: RuntimeId,
  title?: string,
): Promise<Conversation> =>
  invoke("create_conversation", { modelId, runtime, title });

export const getConversation = (id: string): Promise<Conversation> =>
  invoke("get_conversation", { id });

export const deleteConversation = (id: string): Promise<void> =>
  invoke("delete_conversation", { id });

/* ---------- chat ---------- */

/**
 * Begin a chat turn. The user's message is appended; the assistant reply
 * streams back via the `chat:chunk:<conversationId>` event channel.
 *
 * Returns a turn id that you can use to cancel via `cancelChat`.
 */
export const startChatTurn = (
  conversationId: string,
  userMessage: Message,
  opts: GenOpts = {},
): Promise<string> =>
  invoke("start_chat_turn", { conversationId, userMessage, opts });

export const cancelChat = (turnId: string): Promise<void> =>
  invoke("cancel_chat", { turnId });

export const onChatChunk = (
  conversationId: string,
  cb: (chunk: TokenChunk) => void,
): Promise<UnlistenFn> =>
  listen<TokenChunk>(`chat:chunk:${conversationId}`, (e) => cb(e.payload));

/* ---------- runtime status ---------- */

export interface RuntimeStatus {
  runtime: RuntimeId;
  installed: boolean;
  version?: string;
  error?: string;
}

export const getRuntimeStatus = (): Promise<RuntimeStatus[]> =>
  invoke("runtime_status");
