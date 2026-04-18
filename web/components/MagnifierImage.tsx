"use client";

import { useRef, useState, useCallback } from "react";

interface Props {
  src: string;
  alt: string;
  className?: string;
  zoom?: number;
  panelSize?: number;
  lensSize?: number;
}

export default function MagnifierImage({
  src,
  alt,
  className,
  zoom = 2.5,
  panelSize = 360,
  lensSize = 140,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, relX: 0, relY: 0 });
  const [rect, setRect] = useState<DOMRect | null>(null);

  const handleEnter = useCallback(() => {
    if (!imgRef.current) return;
    setRect(imgRef.current.getBoundingClientRect());
    setActive(true);
  }, []);

  const handleLeave = useCallback(() => setActive(false), []);

  const handleMove = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - r.left) / r.width) * 100;
    const relY = ((e.clientY - r.top) / r.height) * 100;
    setRect(r);
    setPos({ x: e.clientX, y: e.clientY, relX, relY });
  }, []);

  const lensX = rect ? (pos.relX / 100) * rect.width - lensSize / 2 : 0;
  const lensY = rect ? (pos.relY / 100) * rect.height - lensSize / 2 : 0;

  let panelLeft = pos.x + 24;
  let panelTop = (rect?.top ?? pos.y) + 0;
  if (typeof window !== "undefined") {
    if (panelLeft + panelSize > window.innerWidth - 8) {
      panelLeft = (rect?.left ?? pos.x) - panelSize - 24;
    }
    if (panelTop + panelSize > window.innerHeight - 8) {
      panelTop = window.innerHeight - panelSize - 8;
    }
    if (panelTop < 8) panelTop = 8;
  }

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onMouseMove={handleMove}
      />
      {active && rect && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute border-2 border-white/80 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.15)] backdrop-blur-[1px]"
            style={{
              width: lensSize,
              height: lensSize,
              left: Math.max(0, Math.min(lensX, rect.width - lensSize)),
              top: Math.max(0, Math.min(lensY, rect.height - lensSize)),
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none fixed z-[100] rounded-xl overflow-hidden border border-stone-200 shadow-2xl bg-white"
            style={{
              width: panelSize,
              height: panelSize,
              left: panelLeft,
              top: panelTop,
              backgroundImage: `url(${src})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${rect.width * zoom}px ${rect.height * zoom}px`,
              backgroundPosition: `${-(pos.relX / 100) * rect.width * zoom + panelSize / 2}px ${-(pos.relY / 100) * rect.height * zoom + panelSize / 2}px`,
            }}
          />
        </>
      )}
    </div>
  );
}
