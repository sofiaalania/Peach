import { afterEach, describe, expect, it, vi } from "vitest";
import { authSiteUrl, cognitoAuthConfig } from "@/lib/auth-config";

afterEach(() => vi.unstubAllGlobals());

describe("OAuth redirects", () => {
  it("uses localhost even when the build site URL is production", () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
    expect(authSiteUrl()).toBe("http://localhost:3000");
  });
  it("keeps production flows on the production origin", () => {
    vi.stubGlobal("window", { location: { origin: "https://example.cloudfront.net" } });
    expect(authSiteUrl()).toBe("https://example.cloudfront.net");
  });
  it("uses the callback and logout paths allowed by Cognito", () => {
    expect(cognitoAuthConfig.redirect_uri).toBe(`${window.location.origin}/auth/callback/`);
    expect(cognitoAuthConfig.post_logout_redirect_uri).toBe(`${window.location.origin}/home/`);
  });
  it("removes OAuth parameters without processing the callback again", () => {
    window.history.replaceState({}, "", "/auth/callback/?code=test&state=test");
    cognitoAuthConfig.onSigninCallback();
    expect(window.location.pathname).toBe("/auth/callback/");
    expect(window.location.search).toBe("");
  });
});
