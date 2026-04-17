import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fashion For Everyone",
  description: "Your digital atelier concierge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#9b3f00",
          colorBackground: "#f6f6f6",
          colorText: "#2d2f2f",
          fontFamily: "Manrope, sans-serif",
          borderRadius: "0.75rem",
        },
      }}
    >
      <html lang="en" className="light">
        <head>
          <link
            href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap"
            rel="stylesheet"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className="min-h-screen bg-background text-on-surface">{children}</body>
      </html>
    </ClerkProvider>
  );
}
