"use client";

import { useAuth } from "react-oidc-context";
import { useEffect } from "react";

export default function AuthCallbackPage() {
  const auth = useAuth();

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) {
      window.location.replace("/home/");
    }
  }, [auth.isLoading, auth.isAuthenticated]);

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