"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/types";
import MagnifierImage from "./MagnifierImage";

interface Props {
  messages: Message[];
  loading: boolean;
}

export default function MessageList({ messages, loading }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading]);

  if (messages.length === 0 && !loading) {
    return (
      <div className="mb-12 text-center">
        <h3 className="editorial-headline text-4xl md:text-5xl font-extrabold text-on-surface tracking-tighter mb-4">
          Ready for your <span className="text-primary italic">next silhouette?</span>
        </h3>
        <p className="text-on-surface-variant max-w-lg mx-auto">
          I am your digital atelier concierge. Describe a look and I&apos;ll generate it for you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {messages.map((m) =>
        m.role === "assistant" ? (
          <AssistantBubble key={m.id} message={m} />
        ) : (
          <UserBubble key={m.id} message={m} />
        )
      )}
      {loading && <LoadingBubble />}
      <div ref={endRef} />
    </div>
  );
}

function AssistantBubble({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2 px-1">
        <div className="h-6 w-6 bg-primary-container rounded-full flex items-center justify-center">
          <span
            className="material-symbols-outlined text-[14px] text-on-primary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            auto_awesome
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
          The Atelier
        </span>
      </div>
      <div
        className={[
          "bg-surface-container-lowest p-6 rounded-xl rounded-bl-none max-w-[85%] shadow-sm",
          message.error ? "text-error" : "text-on-surface",
        ].join(" ")}
      >
        {message.text && (
          <p className="font-['Manrope'] text-lg leading-relaxed whitespace-pre-wrap break-words">
            {message.text}
          </p>
        )}
        {(() => {
          const front = message.frontImageUrl ?? message.imageUrl;
          const back = message.backImageUrl;
          if (!front && !back) return null;
          return (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {front && (
                <figure className="rounded-xl overflow-hidden bg-surface-container-low">
                  <MagnifierImage
                    src={front}
                    alt="Generated look — front view"
                    className="w-full h-auto max-h-[520px] object-cover cursor-zoom-in"
                  />
                  <figcaption className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant px-3 py-2">
                    Front
                  </figcaption>
                </figure>
              )}
              {back && (
                <figure className="rounded-xl overflow-hidden bg-surface-container-low">
                  <MagnifierImage
                    src={back}
                    alt="Generated look — back view"
                    className="w-full h-auto max-h-[520px] object-cover cursor-zoom-in"
                  />
                  <figcaption className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant px-3 py-2">
                    Back
                  </figcaption>
                </figure>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-end gap-3">
      <div className="bg-primary text-on-primary py-[17px] px-6 rounded-xl rounded-br-none max-w-[85%] shadow-[0_12px_40px_rgba(155,63,0,0.06)]">
        <p className="font-['Manrope'] text-lg leading-relaxed whitespace-pre-wrap break-words">
          {message.text}
        </p>
      </div>
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2 px-1">
        <div className="h-6 w-6 bg-primary-container rounded-full flex items-center justify-center">
          <span
            className="material-symbols-outlined text-[14px] text-on-primary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            auto_awesome
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
          The Atelier
        </span>
      </div>
      <div className="bg-surface-container-lowest text-on-surface p-6 rounded-xl rounded-bl-none max-w-[85%] shadow-sm">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span
            className="h-2 w-2 rounded-full bg-primary animate-pulse"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-2 w-2 rounded-full bg-primary animate-pulse"
            style={{ animationDelay: "300ms" }}
          />
          <span className="ml-3 text-sm text-on-surface-variant">
            Draping the silhouette…
          </span>
        </div>
      </div>
    </div>
  );
}
