"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import MessageList from "@/components/MessageList";
import type { ChatDTO, ChatSummaryDTO, MessageDTO } from "@/lib/dto";
import {
  createChat,
  deleteChat as apiDeleteChat,
  getChat,
  listChats,
  sendMessage,
} from "@/lib/api";

type ChatMap = Record<string, ChatDTO>;

export default function ChatPage() {
  const [summaries, setSummaries] = useState<ChatSummaryDTO[]>([]);
  const [chatsById, setChatsById] = useState<ChatMap>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track which chats we've already hydrated so we don't refetch every switch.
  const hydratedRef = useRef<Set<string>>(new Set());

  const setSummaryFromChat = useCallback((chat: { id: string; title: string; updatedAt: number; createdAt?: number }) => {
    setSummaries((prev) => {
      const others = prev.filter((c) => c.id !== chat.id);
      const existing = prev.find((c) => c.id === chat.id);
      const next: ChatSummaryDTO = {
        id: chat.id,
        title: chat.title,
        createdAt: existing?.createdAt ?? chat.createdAt ?? Date.now(),
        updatedAt: chat.updatedAt,
      };
      return [next, ...others].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  // Initial load — list chats, then hydrate the most recent one.
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const list = await listChats({ signal: ac.signal });
        setSummaries(list);
        if (list.length > 0) {
          const first = list[0]!;
          setActiveId(first.id);
          const full = await getChat(first.id, { signal: ac.signal });
          setChatsById((prev) => ({ ...prev, [first.id]: full }));
          hydratedRef.current.add(first.id);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        setBootstrapping(false);
      }
    })();
    return () => ac.abort();
  }, []);

  // Hydrate a chat lazily when the user switches to one we haven't loaded yet.
  useEffect(() => {
    if (!activeId || hydratedRef.current.has(activeId)) return;
    const ac = new AbortController();
    (async () => {
      try {
        const full = await getChat(activeId, { signal: ac.signal });
        setChatsById((prev) => ({ ...prev, [activeId]: full }));
        hydratedRef.current.add(activeId);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      }
    })();
    return () => ac.abort();
  }, [activeId]);

  const sortedSummaries = useMemo(
    () => [...summaries].sort((a, b) => b.updatedAt - a.updatedAt),
    [summaries]
  );

  // Adapter for the legacy Sidebar shape — it only reads .messages.length to
  // decide if a chat is "blank", so we just pass an array of the right length.
  const sidebarChats = useMemo(
    () =>
      sortedSummaries.map((s) => {
        const len = chatsById[s.id]?.messages.length ?? 0;
        return {
          id: s.id,
          title: s.title,
          messages: new Array(len).fill(null) as never[],
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      }),
    [sortedSummaries, chatsById]
  );

  const activeChat = activeId ? chatsById[activeId] : null;

  const handleNewChat = async () => {
    // Don't double-create if the user already has a fresh, empty chat.
    const blank = sortedSummaries.find((s) => {
      const full = chatsById[s.id];
      return full && full.messages.length === 0;
    });
    if (blank) {
      setActiveId(blank.id);
      return;
    }
    try {
      const chat = await createChat();
      setChatsById((prev) => ({ ...prev, [chat.id]: chat }));
      hydratedRef.current.add(chat.id);
      setSummaryFromChat(chat);
      setActiveId(chat.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    const previousActive = activeId;
    setSummaries((prev) => prev.filter((c) => c.id !== id));
    setChatsById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    hydratedRef.current.delete(id);
    if (activeId === id) {
      const fallback = summaries.find((c) => c.id !== id);
      setActiveId(fallback?.id ?? null);
    }
    try {
      await apiDeleteChat(id);
    } catch (err) {
      // Best-effort revert. Worst case the user sees the chat reappear.
      setError((err as Error).message);
      try {
        const list = await listChats();
        setSummaries(list);
        if (previousActive) setActiveId(previousActive);
      } catch {
        /* ignore */
      }
    }
  };

  const handleSend = async (text: string) => {
    let targetId = activeId;
    let targetChat = activeChat;
    if (!targetId || !targetChat) {
      try {
        const created = await createChat();
        setChatsById((prev) => ({ ...prev, [created.id]: created }));
        hydratedRef.current.add(created.id);
        setSummaryFromChat(created);
        setActiveId(created.id);
        targetId = created.id;
        targetChat = created;
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }

    const provisionalUserMsg: MessageDTO = {
      id: `tmp_user_${Date.now()}`,
      chatId: targetId,
      role: "user",
      text,
      ordering: targetChat.messages.length,
      error: false,
      createdAt: Date.now(),
    };
    setChatsById((prev) => {
      const cur = prev[targetId!];
      if (!cur) return prev;
      return { ...prev, [targetId!]: { ...cur, messages: [...cur.messages, provisionalUserMsg] } };
    });
    setLoading(true);

    try {
      const res = await sendMessage(targetId, text);
      setChatsById((prev) => {
        const cur = prev[targetId!];
        if (!cur) return prev;
        // Replace provisional user msg with server one + append assistant msg.
        const withoutProvisional = cur.messages.filter((m) => m.id !== provisionalUserMsg.id);
        return {
          ...prev,
          [targetId!]: {
            ...cur,
            title: res.chat.title,
            updatedAt: res.assistantMessage.createdAt,
            messages: [...withoutProvisional, res.userMessage, res.assistantMessage],
          },
        };
      });
      setSummaryFromChat({
        id: targetId,
        title: res.chat.title,
        updatedAt: res.assistantMessage.createdAt,
      });
    } catch (err) {
      const msg = (err as Error).message ?? "Something went wrong.";
      setChatsById((prev) => {
        const cur = prev[targetId!];
        if (!cur) return prev;
        const errorMsg: MessageDTO = {
          id: `tmp_err_${Date.now()}`,
          chatId: targetId!,
          role: "assistant",
          text: msg,
          ordering: cur.messages.length,
          error: true,
          createdAt: Date.now(),
        };
        return { ...prev, [targetId!]: { ...cur, messages: [...cur.messages, errorMsg] } };
      });
    } finally {
      setLoading(false);
    }
  };

  // Adapter — Sidebar/MessageList expect the legacy {Chat, Message} shape with
  // `messages` always present. Map MessageDTO → Message for rendering.
  const renderMessages = useMemo(
    () =>
      (activeChat?.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role === "system" ? "assistant" : (m.role as "user" | "assistant"),
        text: m.text,
        imageUrl: m.imageUrl,
        createdAt: m.createdAt,
        error: m.error,
      })),
    [activeChat]
  );

  return (
    <>
      <Sidebar
        chats={sidebarChats}
        activeId={activeId}
        collapsed={collapsed}
        onSelect={setActiveId}
        onNewChat={handleNewChat}
        onToggle={() => setCollapsed((v) => !v)}
        onDelete={handleDelete}
      />

      <main className="flex-1 flex flex-col relative h-full bg-surface min-w-0">
        <header className="sticky top-0 z-40 bg-[#f6f6f6]/80 backdrop-blur-xl flex justify-between items-center px-6 h-16 shrink-0">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-xl font-bold tracking-tighter text-[#2d2f2f] font-headline hover:text-primary transition-colors"
            >
              Fashion For Everyone
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex gap-6 mr-6">
              <span className="text-[#9b3f00] font-bold text-sm tracking-tight font-headline">
                Chat
              </span>
            </div>
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        {error && (
          <div className="bg-error/10 text-error px-6 py-3 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs uppercase tracking-widest font-bold hover:opacity-80"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto pb-40 px-6 lg:px-12 w-full custom-scrollbar">
          <div className="max-w-5xl mx-auto w-full pt-6">
            {bootstrapping ? (
              <div className="flex items-center justify-center py-24 text-on-surface-variant">
                <span className="material-symbols-outlined animate-spin mr-3">progress_activity</span>
                Loading your atelier...
              </div>
            ) : (
              <MessageList messages={renderMessages} loading={loading} />
            )}
          </div>
        </div>

        <ChatInput onSend={handleSend} disabled={loading || bootstrapping} />
      </main>
    </>
  );
}
