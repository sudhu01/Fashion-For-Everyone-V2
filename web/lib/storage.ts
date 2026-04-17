import type { Chat, Message } from "./types";

const KEY = "ffe:chats:v1";

export function loadChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChat);
  } catch {
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    // quota exceeded or storage unavailable — fail silently
  }
}

export function newChatId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newChat(): Chat {
  const now = Date.now();
  return {
    id: newChatId(),
    title: "New Fitting",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 42) return t || "New Fitting";
  return t.slice(0, 42) + "…";
}

function isChat(v: unknown): v is Chat {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<Chat>;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    Array.isArray(c.messages) &&
    typeof c.createdAt === "number" &&
    typeof c.updatedAt === "number"
  );
}

export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function appendMessage(chat: Chat, msg: Message): Chat {
  return {
    ...chat,
    messages: [...chat.messages, msg],
    updatedAt: Date.now(),
    title:
      chat.messages.length === 0 && msg.role === "user"
        ? deriveTitle(msg.text)
        : chat.title,
  };
}
