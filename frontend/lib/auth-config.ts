import type { AuthProviderProps } from "react-oidc-context";

// Keep OAuth state and callbacks on the origin that started authentication.
export function authSiteUrl(): string {
  return typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export const cognitoAuthConfig = {
  authority: process.env.NEXT_PUBLIC_COGNITO_AUTHORITY!,
  client_id: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
  redirect_uri: `${authSiteUrl()}/auth/callback/`,
  post_logout_redirect_uri: `${authSiteUrl()}/home/`,
  response_type: "code",
  scope: "openid email profile",
  automaticSilentRenew: false,
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
} satisfies AuthProviderProps;
