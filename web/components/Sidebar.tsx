"use client";

import type { Chat } from "@/lib/types";

interface Props {
  chats: Chat[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onToggle: () => void;
  onDelete: (id: string) => void;
}

export default function Sidebar({
  chats,
  activeId,
  collapsed,
  onSelect,
  onNewChat,
  onToggle,
  onDelete,
}: Props) {
  return (
    <aside
      className={[
        "flex flex-col h-full py-8 bg-[#f0f1f1] dark:bg-stone-900 shrink-0",
        "font-['Manrope'] font-medium text-sm transition-all duration-300 ease-out overflow-hidden",
        collapsed ? "w-20 px-2" : "w-72 px-4",
      ].join(" ")}
    >
      <div className={["mb-10 flex items-center", collapsed ? "justify-center" : "justify-between px-4"].join(" ")}>
        {!collapsed && (
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] font-bold text-[#9b3f00] text-lg tracking-tight">
              The Atelier
            </h1>
            <p className="text-[#acadad] text-xs uppercase tracking-widest mt-1">
              Your Digital Concierge
            </p>
          </div>
        )}
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-2 rounded-full hover:bg-white/60 text-on-surface-variant transition-colors"
        >
          <span className="material-symbols-outlined text-xl">
            {collapsed ? "menu_open" : "menu"}
          </span>
        </button>
      </div>

      <button
        onClick={onNewChat}
        className={[
          "mx-2 mb-8 py-3 bg-primary text-on-primary rounded-full flex items-center justify-center gap-2",
          "transition-all hover:bg-primary-dim active:scale-95 shadow-[0_12px_40px_rgba(155,63,0,0.15)]",
          collapsed ? "px-0" : "px-6",
        ].join(" ")}
      >
        <span className="material-symbols-outlined text-xl">add_circle</span>
        {!collapsed && <span className="font-bold">New Fitting</span>}
      </button>

      <nav className="flex-1 space-y-1 custom-scrollbar overflow-y-auto px-2">
        {!collapsed && (
          <div className="text-[#acadad] text-[10px] font-bold uppercase tracking-[0.2em] mb-4 px-2">
            Recent Consultations
          </div>
        )}
        {chats.length === 0 && !collapsed && (
          <p className="text-[#acadad] text-xs px-3">
            No consultations yet. Start a new fitting to begin.
          </p>
        )}
        {chats.map((c) => {
          const active = c.id === activeId;
          return (
            <div
              key={c.id}
              className={[
                "group relative flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer",
                active
                  ? "bg-white/50 backdrop-blur-sm text-[#2d2f2f] font-bold translate-x-1"
                  : "text-[#acadad] hover:text-[#9b3f00]",
              ].join(" ")}
              onClick={() => onSelect(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(c.id);
              }}
              title={c.title}
            >
              <span
                className={["material-symbols-outlined", active ? "text-[#9b3f00]" : ""].join(" ")}
              >
                history
              </span>
              {!collapsed && (
                <>
                  <span className="truncate flex-1">{c.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    aria-label="Delete chat"
                    className="opacity-0 group-hover:opacity-100 text-[#acadad] hover:text-error transition-opacity"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                </>
              )}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-auto border-t border-transparent pt-6 space-y-2 px-2">
          <button className="w-full flex items-center gap-3 p-3 rounded-xl text-[#acadad] hover:text-[#9b3f00] transition-all">
            <span className="material-symbols-outlined">settings</span>
            Settings
          </button>
          <button className="w-full flex items-center gap-3 p-3 rounded-xl text-[#acadad] hover:text-[#9b3f00] transition-all">
            <span className="material-symbols-outlined">help</span>
            Support
          </button>
        </div>
      )}
    </aside>
  );
}
