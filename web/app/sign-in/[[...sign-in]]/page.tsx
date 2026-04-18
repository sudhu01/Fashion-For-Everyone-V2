import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in | Fashion For Everyone" };

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-black">
      <SignIn
        appearance={{
          elements: {
            card: "shadow-2xl rounded-2xl",
          },
        }}
        fallbackRedirectUrl="/chat"
        signUpUrl="/sign-up"
      />
    </div>
  );
}
