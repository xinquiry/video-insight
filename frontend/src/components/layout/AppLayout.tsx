import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLogout, useMe } from "@/features/auth/hooks";
import { Sidebar } from "./Sidebar";

export function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)] text-[var(--ink)] md:h-screen md:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-[var(--ink)] bg-[var(--paper)] px-6">
          <div className="hidden items-baseline gap-3 md:flex">
            <span className="vi-kicker">{t("brand.studio")}</span>
            <span className="vi-display text-base italic">{t("brand.tagline")}</span>
          </div>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <span className="vi-mono text-xs text-[var(--muted)]">{t("auth.signedIn")}</span>
              <span className="vi-display text-base italic">{user.username}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="vi-icon-button"
                aria-label={t("auth.logout")}
                title={t("auth.logout")}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-y-auto px-5 py-6 md:px-8 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
