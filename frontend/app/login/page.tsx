"use client";

import { useAuth } from "react-oidc-context";
import { useEffect, useRef } from "react";

export default function LoginPage() {
  const auth = useAuth();
  const redirectStarted = useRef(false);

  useEffect(() => {
    if (auth.isLoading || auth.activeNavigator || redirectStarted.current) {
      return;
    }

    if (auth.isAuthenticated) {
      window.location.replace("/home/");
      return;
    }

    redirectStarted.current = true;
    void auth.signinRedirect();
  }, [auth]);

  if (auth.error) {
    return (
      <main className="p-8">
        <p>Login failed: {auth.error.message}</p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <p>Redirecting to login...</p>
    </main>
  );
}