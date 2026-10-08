
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "react-oidc-context";

import { cn } from "@/lib/utils";

const links = [
  { href: "/home", label: "Home" },
  { href: "/items", label: "Board" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const auth = useAuth();

  const email = auth.user?.profile.email;

  const handleLogout = async () => {
    await auth.signoutRedirect();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-8 px-6 sm:px-8">
        <Link href="/home" className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-md bg-foreground font-heading text-[13px] leading-none font-semibold text-background"
          >
            P
          </span>
          <span className="font-heading text-[15px] font-semibold tracking-tight">
            Peach
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {links.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 font-medium transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {auth.isLoading ? (
            <span className="text-muted-foreground">Loading...</span>
          ) : auth.isAuthenticated ? (
            <>
              <span className="hidden max-w-48 truncate text-muted-foreground sm:inline">
                {email ?? "Signed in"}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-accent"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/login/"
              className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background hover:opacity-80"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
