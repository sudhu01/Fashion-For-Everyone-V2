import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Sign up | Fashion For Everyone" };

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-black">
      <SignUp
        appearance={{
          elements: {
            card: "shadow-2xl rounded-2xl",
          },
        }}
        fallbackRedirectUrl="/chat"
        signInUrl="/sign-in"
      />
    </div>
  );
}
