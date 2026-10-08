import type { AuthProviderProps } from "react-oidc-context";

export const cognitoAuthConfig: AuthProviderProps = {
  authority: process.env.NEXT_PUBLIC_COGNITO_AUTHORITY!,
  client_id: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
  redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback/`,
  post_logout_redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/home/`,
  response_type: "code",
  scope: "openid email profile",
  automaticSilentRenew: false,
  onSigninCallback: () => {
    window.location.replace("/home/");
  },
};
