// Client-side API helpers. Every call is a fetch to our own /api/*, which is
// auth-gated by Clerk middleware + requireAuth(). We don't send credentials
// manually — Clerk's session cookie rides along with same-origin requests.

import type { ChatDTO, ChatSummaryDTO, MessageDTO } from "./dto";

interface ApiOptions {
  signal?: AbortSignal;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : null) ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function listChats(opts?: ApiOptions): Promise<ChatSummaryDTO[]> {
  const { chats } = await request<{ chats: ChatSummaryDTO[] }>("/api/chats", {
    method: "GET",
    signal: opts?.signal,
  });
  return chats;
}

export async function createChat(opts?: ApiOptions): Promise<ChatDTO> {
  const { chat } = await request<{ chat: ChatDTO }>("/api/chats", {
    method: "POST",
    body: JSON.stringify({}),
    signal: opts?.signal,
  });
  return chat;
}

export async function getChat(id: string, opts?: ApiOptions): Promise<ChatDTO> {
  const { chat } = await request<{ chat: ChatDTO }>(`/api/chats/${encodeURIComponent(id)}`, {
    method: "GET",
    signal: opts?.signal,
  });
  return chat;
}

export async function deleteChat(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/chats/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function renameChat(id: string, title: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/chats/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export interface SendMessageResult {
  userMessage: MessageDTO;
  assistantMessage: MessageDTO;
  chat: { id: string; title: string };
}

export async function sendMessage(
  chatId: string,
  prompt: string,
  opts?: ApiOptions
): Promise<SendMessageResult> {
  return request<SendMessageResult>(
    `/api/chats/${encodeURIComponent(chatId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ prompt }),
      signal: opts?.signal,
    }
  );
}
