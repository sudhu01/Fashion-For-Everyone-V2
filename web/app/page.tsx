import Link from "next/link";

export const metadata = {
  title: "Fashion For Everyone",
  description:
    "Your personal atelier, powered by AI. Precision tailoring meets predictive intelligence.",
};

function AnimatedButton({
  label,
  href,
}: {
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group/button relative flex cursor-pointer items-center gap-2 rounded-lg border border-white/20 bg-black py-2 pr-4 pl-11 tracking-tight"
    >
      <div className="absolute inset-y-0 left-1 z-40 my-auto flex size-8 flex-col items-center justify-center gap-px rounded-[5px] bg-[#9b3f00] transition-all duration-400 ease-out group-hover/button:left-[calc(100%-2.3rem)] group-hover/button:rotate-180 group-hover/button:transform">
        <div className="flex flex-col gap-px">
          <div className="flex gap-px">
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
          </div>
          <div className="flex gap-px">
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
          </div>
          <div className="flex gap-px">
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
          </div>
          <div className="flex gap-px">
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
          </div>
          <div className="flex gap-px">
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full animate-pulse bg-white duration-200 ease-linear" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
            <span className="inline-block size-[3px] shrink-0 rounded-full bg-white/25" />
          </div>
        </div>
      </div>
      <div className="absolute -inset-px rounded-lg bg-white/20 transition-[clip-path] duration-400 ease-out [clip-path:inset(0_100%_0_0)] group-hover/button:[clip-path:inset(0_0%_0_0)]" />
      <span className="inline-block text-white transition-transform duration-400 group-hover/button:-translate-x-8">
        {label}
      </span>
    </Link>
  );
}

export default function LandingPage() {
  const heroMask =
    "linear-gradient(to bottom, transparent 0%, #000 20%, #000 50%, transparent 100%), linear-gradient(to right, transparent 0%, #000 50%, #000 100%)";

  return (
    <div className="min-h-screen bg-black antialiased">
      <main className="flex-1">
        <div className="flex min-h-screen items-center justify-center bg-neutral-900">
          <div className="w-full">
            <div className="relative w-full">
              <nav className="absolute inset-x-4 top-4 z-50 flex items-center justify-between px-4 py-4 md:inset-x-10 md:top-10 md:px-10">
                <Link
                  href="/"
                  className="flex items-center justify-center space-x-2 text-center text-2xl font-bold text-gray-100 py-0"
                >
                  <div className="relative h-8 w-8 rounded-md overflow-hidden border border-slate-800">
                    <div className="absolute inset-x-0 -top-10 h-10 w-full rounded-full bg-white/20 blur-xl" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/Fashion For Everyone Logo.png" alt="Logo" className="relative z-20 h-full w-full object-cover" />
                  </div>
                  <div className="hidden flex-col sm:flex">
                    <h1 className="font-sans text-white">Fashion For Everyone</h1>
                  </div>
                </Link>
                <div className="flex items-center gap-4 md:gap-8">
                  <a
                    href="#collections"
                    className="hidden text-sm font-medium text-neutral-400 transition-colors hover:text-neutral-100 sm:block"
                  >
                    Collections
                  </a>
                  <a
                    href="#style"
                    className="hidden text-sm font-medium text-neutral-400 transition-colors hover:text-neutral-100 sm:block"
                  >
                    Style Guide
                  </a>
                  <a
                    href="#atelier"
                    className="hidden text-sm font-medium text-neutral-400 transition-colors hover:text-neutral-100 sm:block"
                  >
                    Atelier
                  </a>
                  <a
                    href="#about"
                    className="hidden text-sm font-medium text-neutral-400 transition-colors hover:text-neutral-100 sm:block"
                  >
                    About
                  </a>
                  <AnimatedButton label="Try for free" href="/chat" />
                </div>
              </nav>

              <div className="relative flex min-h-screen w-full flex-col justify-end p-4 md:p-14">
                <div
                  className="pointer-events-none absolute inset-4 overflow-hidden md:inset-10"
                  style={{ opacity: 1 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="Background"
                    className="h-full w-full object-cover object-center"
                    src="https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=2400&q=80"
                    style={{
                      WebkitMaskImage: heroMask,
                      maskImage: heroMask,
                      WebkitMaskComposite: "source-in",
                      maskComposite: "intersect",
                    }}
                  />
                </div>

                <div className="pointer-events-none absolute inset-x-0 top-4 h-px w-full bg-neutral-800 md:top-10" />
                <div className="pointer-events-none absolute inset-x-0 bottom-4 h-px w-full bg-neutral-800 md:bottom-10" />
                <div className="pointer-events-none absolute inset-y-0 left-4 h-full w-px bg-neutral-800 md:left-10" />
                <div className="pointer-events-none absolute inset-y-0 right-4 h-full w-px bg-neutral-800 md:right-10" />

                <div className="relative z-40 p-4 md:p-4">
                  <h1 className="max-w-3xl text-3xl font-medium tracking-tight text-neutral-200 sm:text-4xl md:text-6xl lg:text-8xl">
                    Fashion at your fingertips
                  </h1>
                  <p className="mt-4 max-w-xl text-base text-neutral-400 md:mt-6 md:text-lg">
                    Create breathtaking looks with AI that understands your vision.
                    No design skills needed—just describe what you imagine and watch
                    it come to life.
                  </p>
                  <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center md:mt-10">
                    <AnimatedButton label="Try for free" href="/chat" />
                    <a
                      href="#atelier"
                      className="text-sm font-medium text-neutral-400 hover:text-neutral-200"
                    >
                      Read Documentation →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
