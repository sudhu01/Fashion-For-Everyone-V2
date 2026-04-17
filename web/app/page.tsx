import Link from "next/link";

export const metadata = {
  title: "Fashion For Everyone",
  description:
    "Your personal atelier, powered by AI. Precision tailoring meets predictive intelligence.",
};

export default function LandingPage() {
  return (
    <div className="bg-background text-on-surface font-body selection:bg-primary-container selection:text-on-primary-container">
      <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl shadow-sm">
        <nav className="flex justify-between items-center px-6 py-4 max-w-7xl mx-auto font-headline tracking-tight">
          <div className="text-2xl font-bold tracking-tighter text-stone-900">
            Fashion For Everyone
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a className="text-stone-600 hover:text-stone-900 transition-all duration-300 hover:opacity-80" href="#features">
              Collections
            </a>
            <a className="text-stone-600 hover:text-stone-900 transition-all duration-300 hover:opacity-80" href="#journey">
              Style Guide
            </a>
            <a className="text-stone-600 hover:text-stone-900 transition-all duration-300 hover:opacity-80" href="#about">
              About
            </a>
            <a className="text-stone-600 hover:text-stone-900 transition-all duration-300 hover:opacity-80" href="#features">
              Atelier
            </a>
          </div>
          <div className="flex items-center gap-5">
            <span className="material-symbols-outlined text-stone-600 cursor-pointer hover:text-primary transition-colors">
              shopping_bag
            </span>
            <span className="material-symbols-outlined text-stone-600 cursor-pointer hover:text-primary transition-colors">
              person
            </span>
            <Link
              href="/chat"
              className="editorial-gradient text-on-primary font-semibold px-6 py-2.5 rounded-full shadow-lg shadow-primary/20 scale-95 duration-200 active:opacity-70 inline-block"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      <main className="pt-24">
        <section className="relative px-6 py-16 md:py-32 max-w-7xl mx-auto overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-container-high rounded-full mb-6">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant font-label">
                  The Digital Atelier
                </span>
              </div>
              <h1 className="text-5xl md:text-7xl font-extrabold font-headline leading-[1.1] mb-8 text-on-surface tracking-tight">
                Your personal <span className="text-primary italic">atelier</span>, powered by AI.
              </h1>
              <p className="text-lg md:text-xl text-on-surface-variant mb-10 max-w-lg leading-relaxed">
                Precision tailoring meets predictive intelligence. We curate your wardrobe with the
                soul of a stylist and the speed of a supercomputer.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/chat"
                  className="editorial-gradient text-on-primary font-bold text-lg px-8 py-4 rounded-full shadow-xl shadow-primary/20 transition-transform active:scale-95 inline-block text-center"
                >
                  Start your consultation
                </Link>
                <a
                  href="#features"
                  className="bg-surface-container-highest text-on-surface font-bold text-lg px-8 py-4 rounded-full transition-transform active:scale-95 inline-block text-center"
                >
                  View Collections
                </a>
              </div>
            </div>
            <div className="relative">
              <div className="aspect-[4/5] rounded-xl overflow-hidden bg-surface-container-low shadow-2xl relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Fashion model"
                  className="w-full h-full object-cover"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCJ9BQXYjtNKBO-dmH8g380sSUjMlpP_yo0a43osRGfJwIBCJYVa7v9AjnW0OmeGp5JrIItY3QL8Q_RotSzPXdEGnDOWhrnwstcGS4D3NWuP_iNmQHDxdtY79Wko4oW6bsQ9nnDGDLwiPPiQBmuyCovUmbbOgK-iyP5IZV6TOj7clOYOX3CY2BpKKWai-C-7Ux-KpA3xyMySUfwGT4K4BwWNZa2vfvFL_O-UcG1dEeGvm3dbxj8IjOoBp9qRoMjF4-JODfkmwFDqSo2"
                />
                <div className="absolute bottom-6 left-6 right-6 p-6 bg-white/20 backdrop-blur-xl rounded-xl border border-white/30">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center">
                      <span
                        className="material-symbols-outlined text-on-primary-fixed"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        auto_awesome
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-stone-900">AI Recommendation</p>
                      <p className="text-xs text-stone-800">Couture Silk Scarf, Ember Collection</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-tertiary-fixed-dim/20 blur-3xl rounded-full -z-10" />
            </div>
          </div>
        </section>

        <section className="py-12 bg-surface-container-low">
          <div className="max-w-7xl mx-auto px-6">
            <p className="text-center font-label text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-10">
              As seen in global fashion circles
            </p>
            <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
              <span className="text-2xl font-black font-headline tracking-tighter">VOGUE</span>
              <span className="text-2xl font-black font-headline tracking-tighter italic">ELLE</span>
              <span className="text-2xl font-black font-headline tracking-tighter">BAZAAR</span>
              <span className="text-2xl font-black font-headline tracking-tighter">GQ</span>
              <span className="text-2xl font-black font-headline tracking-tighter">NYFW</span>
            </div>
          </div>
        </section>

        <section id="features" className="py-24 px-6 max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-extrabold font-headline mb-4">
              Precision Craftsmanship
            </h2>
            <p className="text-on-surface-variant text-lg">
              Every detail designed for the modern wardrobe.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-8 bg-surface-container-lowest rounded-xl p-8 flex flex-col justify-between group overflow-hidden">
              <div>
                <span className="material-symbols-outlined text-primary text-4xl mb-6">psychology</span>
                <h3 className="text-2xl font-bold mb-4">Cognitive AI Styling</h3>
                <p className="text-on-surface-variant max-w-md">
                  Our neural engine learns your aesthetic preferences, body architecture, and
                  lifestyle to suggest silhouettes that resonate with your personal brand.
                </p>
              </div>
              <div className="mt-12 relative">
                <div className="flex gap-4">
                  <div className="w-48 h-64 rounded-lg bg-surface-container overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="Styled look"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuCdTmo2uUdknaSdFTl3d6mqnq3jTrPdnJAQZWKntnzc33Yb5QNwclmk8XiDC57dnCQTtCm9Gq2iRGXiCtp_wt0DHMO43DA5Gvjv-pTWiSfwrf9sdbP0MshGv4nqzRbrCHcO7YqgeCVXb2GSGZC1s6X4iBFIqABzF7Q7iEAioAje56_YyTbUKxKtQCdMJCDIRJnFvRgpWW9e-d_tH4_e5ZTZdZzkwbbUG5Oe_wvImvoqPXOZdQv0iUSyHLD4igcAqkO0SMJOAWCSgIFR"
                    />
                  </div>
                  <div className="w-48 h-64 rounded-lg bg-surface-container overflow-hidden translate-y-8">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="Styled look"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuBXa0yxEZ0NGQyRFPmOK69VgkXNo22bRW1QdAmt31tX-whVMlyQFqp4OgL5EPnHJy_XXE1NBVBMzR_5ZsSvJrcm5nzZFGzUcBjvESLDPDxhYjHkVNO9tg8kjRqpKpnJmWf9KSybtt6t0BU3mM4uyD2kOkmhK2uME5nU1NCtfx62X7AhHU72HsRI1sA7bMX8rQJXtm-yO1iZsEgcYTL8XeNReeQCtHp3ojqSBQASVPYDBsSk0u8-GALWTvPFZ8_IESzwi2dAUVXR2POt"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="md:col-span-4 bg-primary text-on-primary rounded-xl p-8 flex flex-col justify-between shadow-2xl shadow-primary/30">
              <span className="material-symbols-outlined text-4xl mb-6">inventory_2</span>
              <div>
                <h3 className="text-2xl font-bold mb-4">Smart Closet Integration</h3>
                <p className="opacity-80">
                  Digitize your existing wardrobe. Our AI visualizes new pairings so you never say
                  &quot;I have nothing to wear&quot; again.
                </p>
              </div>
            </div>
            <div className="md:col-span-4 bg-surface-container-high rounded-xl p-8">
              <span className="material-symbols-outlined text-primary text-4xl mb-6">
                notifications_active
              </span>
              <h3 className="text-2xl font-bold mb-4">Real-time Trend Alerts</h3>
              <p className="text-on-surface-variant">
                Stay ahead of the curve with predictive alerts for drops that match your unique
                style profile.
              </p>
            </div>
            <div className="md:col-span-8 bg-surface-container-low rounded-xl p-8 border border-outline-variant/10">
              <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="flex-1">
                  <h3 className="text-2xl font-bold mb-4">The Atelier Studio</h3>
                  <p className="text-on-surface-variant">
                    Virtually swap fabrics, colors, and textures on curated garments before you even
                    consider a purchase.
                  </p>
                </div>
                <div className="flex-1 w-full grid grid-cols-3 gap-2">
                  <div className="aspect-square rounded-full bg-orange-200 border-2 border-white" />
                  <div className="aspect-square rounded-full bg-orange-500 border-2 border-white" />
                  <div className="aspect-square rounded-full bg-stone-800 border-2 border-white" />
                  <div className="aspect-square rounded-full bg-stone-300 border-2 border-white" />
                  <div className="aspect-square rounded-full bg-orange-700 border-2 border-white" />
                  <div className="aspect-square rounded-full bg-white border-2 border-white" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="journey" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-20">
              <h2 className="text-4xl font-extrabold font-headline">The Concierge Journey</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              {[
                {
                  step: "01",
                  title: "Chat with Your Muse",
                  body:
                    "Tell our AI about your mood, the event, or your inspiration. It understands style like a seasoned creative director.",
                },
                {
                  step: "02",
                  title: "Curate Your Canvas",
                  body:
                    "Review three tailored \u201cLook-Books\u201d generated specifically for you. Swap items with a single gesture.",
                },
                {
                  step: "03",
                  title: "Wear Your Identity",
                  body:
                    "Shop the pieces you love or use your current wardrobe to recreate the curated aesthetic instantly.",
                },
              ].map((s) => (
                <div key={s.step} className="relative group">
                  <div className="text-8xl font-black text-surface-container absolute -top-12 -left-4 z-0 group-hover:text-primary-fixed-dim/20 transition-colors">
                    {s.step}
                  </div>
                  <div className="relative z-10 pt-4">
                    <h4 className="text-xl font-bold mb-4">{s.title}</h4>
                    <p className="text-on-surface-variant leading-relaxed">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="about" className="py-32 px-6">
          <div className="max-w-5xl mx-auto editorial-gradient rounded-[2.5rem] p-12 md:p-24 text-center text-on-primary shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-black/5 rounded-full translate-y-1/2 -translate-x-1/2" />
            <div className="relative z-10">
              <h2 className="text-4xl md:text-6xl font-extrabold font-headline mb-8 leading-tight">
                Elevate your style today.
              </h2>
              <p className="text-xl mb-12 text-on-primary/80 max-w-2xl mx-auto">
                Join the world&apos;s most exclusive digital atelier and redefine how you experience
                fashion.
              </p>
              <Link
                href="/chat"
                className="bg-white text-primary font-bold text-xl px-12 py-5 rounded-full shadow-2xl hover:bg-stone-50 transition-colors active:scale-95 inline-block"
              >
                Get Your Invitation
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="w-full py-12 px-8 bg-stone-100 font-body text-sm uppercase tracking-widest mt-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 max-w-7xl mx-auto">
          <div className="md:col-span-1">
            <div className="text-lg font-black text-stone-800 mb-6">fashion For Everyone</div>
            <p className="normal-case text-stone-500 tracking-normal mb-6">
              Democratizing luxury through the lens of artificial intelligence.
            </p>
          </div>
          <div>
            <h5 className="font-bold text-orange-700 mb-6">Experience</h5>
            <ul className="space-y-4">
              <li>
                <Link className="text-stone-500 hover:text-orange-500 transition-colors" href="/chat">
                  Digital Atelier
                </Link>
              </li>
              <li>
                <a className="text-stone-500 hover:text-orange-500 transition-colors" href="#features">
                  Wardrobe AI
                </a>
              </li>
              <li>
                <a className="text-stone-500 hover:text-orange-500 transition-colors" href="#journey">
                  Style Guide
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold text-orange-700 mb-6">Company</h5>
            <ul className="space-y-4">
              <li>
                <a className="text-stone-500 hover:text-orange-500 transition-colors" href="#">
                  Contact
                </a>
              </li>
              <li>
                <a className="text-stone-500 hover:text-orange-500 transition-colors" href="#">
                  Instagram
                </a>
              </li>
              <li>
                <a className="text-stone-500 hover:text-orange-500 transition-colors" href="#">
                  Careers
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold text-orange-700 mb-6">Legal</h5>
            <ul className="space-y-4">
              <li>
                <a className="text-stone-500 hover:text-orange-500 transition-colors" href="#">
                  Privacy
                </a>
              </li>
              <li>
                <a className="text-stone-500 hover:text-orange-500 transition-colors" href="#">
                  Terms
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-stone-200 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-stone-400">
            &copy; {new Date().getFullYear()} Fashion For Everyone. All rights reserved.
          </p>
          <div className="flex gap-6">
            <span className="material-symbols-outlined text-stone-400 cursor-pointer hover:text-primary">
              language
            </span>
            <span className="material-symbols-outlined text-stone-400 cursor-pointer hover:text-primary">
              share
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
