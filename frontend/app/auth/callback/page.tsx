"use client";

import { useAuth } from "react-oidc-context";

export default function AuthCallbackPage() {
  const auth = useAuth();

  if (auth.error) {
    return (
      <main className="p-8">
        <h1>Authentication failed</h1>
        <p>{auth.error.message}</p>
        <a href="/login/">Try again</a>
      </main>
    );
  }

  return (
    <main className="p-8">
      <p>Completing sign in...</p>
    </main>
  );
}