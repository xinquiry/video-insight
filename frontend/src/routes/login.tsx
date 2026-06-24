import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLogin } from "@/features/auth/hooks";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    login.mutate(
      { username, password },
      { onSuccess: () => navigate({ to: "/" }) },
    );
  };

  const isPending = login.isPending;
  const hasError = login.isError;

  return (
    <main className="grid min-h-screen bg-[var(--paper)] text-[var(--ink)] lg:grid-cols-[1fr_420px]">
      <section className="flex min-h-[45vh] flex-col justify-between border-b border-[var(--ink)] p-8 lg:border-r lg:border-b-0 lg:p-12">
        <div className="flex items-center justify-between">
          <span className="vi-display text-2xl">
            Video <em className="text-[var(--accent)]">Insight</em>
          </span>
          <span className="vi-kicker">{t("brand.studio")}</span>
        </div>
        <div className="max-w-3xl">
          <p className="vi-kicker">{t("auth.login.kicker")}</p>
          <h1 className="vi-display mt-6 text-5xl md:text-7xl">
            {t("auth.login.headline_line1")}
            <br />
            {t("auth.login.headline_line2")}
          </h1>
          <p className="mt-6 max-w-xl text-base text-[var(--muted)]">
            {t("auth.login.subheadline")}
          </p>
        </div>
      </section>
      <section className="flex items-center px-5 py-10 lg:px-8">
      <form
        onSubmit={submit}
        className="vi-panel w-full space-y-6 p-6"
      >
        <div>
          <p className="vi-kicker">{t("auth.login.accountKicker")}</p>
          <h2 className="vi-display mt-2 text-3xl">{t("auth.login.welcome")}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {t("auth.login.hint")}
          </p>
        </div>

        <label className="vi-label">
          {t("auth.login.username")}
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="vi-input mt-1 text-base normal-case"
            minLength={3}
            required
          />
        </label>

        <label className="vi-label">
          {t("auth.login.password")}
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="vi-input mt-1 text-base normal-case"
            type="password"
            required
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="vi-button-primary w-full disabled:opacity-60"
        >
          <LogIn className="h-4 w-4" />
          {isPending ? t("common.working") : t("auth.login.submit")}
        </button>

        {hasError && (
          <p className="text-sm text-[var(--danger)]">
            {t("auth.login.invalid")}
          </p>
        )}
      </form>
      </section>
    </main>
  );
}
