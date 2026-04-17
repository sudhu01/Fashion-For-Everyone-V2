"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const MAX_LEN = 2000;

export default function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (trimmed.length > MAX_LEN) return;
    onSend(trimmed);
    setValue("");
  };

  const count = value.length;
  const nearLimit = count >= MAX_LEN * 0.9;
  const atLimit = count >= MAX_LEN;

  return (
    <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-surface via-surface/95 to-transparent pointer-events-none">
      <div className="max-w-4xl mx-auto relative group pointer-events-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="bg-surface-container-highest/60 backdrop-blur-xl rounded-full p-2 pl-5 flex items-center gap-2 border border-white/20 shadow-lg"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={MAX_LEN}
            autoComplete="off"
            autoCorrect="off"
            spellCheck
            placeholder="Tell me about your style vision..."
            aria-label="Chat prompt"
            className="flex-1 resize-none bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder-on-surface-variant font-['Manrope'] px-2 py-2 max-h-32"
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={disabled || value.trim().length === 0}
            aria-label="Send prompt"
            className="bg-primary hover:bg-primary-dim disabled:opacity-50 disabled:cursor-not-allowed text-on-primary h-12 w-12 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-lg"
          >
            <span className="material-symbols-outlined">
              {disabled ? "hourglass_empty" : "arrow_upward"}
            </span>
          </button>
        </form>
        <div className="mt-3 flex justify-center">
          <span
            aria-live="polite"
            className={[
              "text-[11px] tabular-nums tracking-[0.15em] font-bold transition-colors",
              atLimit
                ? "text-error"
                : nearLimit
                ? "text-primary"
                : "text-on-surface-variant",
            ].join(" ")}
          >
            {count}/{MAX_LEN}
          </span>
        </div>
      </div>
    </div>
  );
}
