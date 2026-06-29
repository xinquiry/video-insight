import { Link, useLocation } from "@tanstack/react-router";
import { Home, Video } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  LANGUAGE_STORAGE_KEY,
  type SupportedLanguage,
  SUPPORTED_LANGUAGES,
} from "@/i18n";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", labelKey: "nav.dashboard", icon: Home },
  { to: "/videos", labelKey: "nav.videos", icon: Video },
] as const;

type LanguageChoice = "system" | SupportedLanguage;

function getStoredChoice(): LanguageChoice {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
    return stored as SupportedLanguage;
  }
  return "system";
}

export function Sidebar() {
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const currentChoice = getStoredChoice();

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as LanguageChoice;
    if (value === "system") {
      window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
      const detected = (navigator.language || "en").toLowerCase().split("-")[0] ?? "en";
      const next = (SUPPORTED_LANGUAGES as readonly string[]).includes(detected)
        ? (detected as SupportedLanguage)
        : "en";
      i18n.changeLanguage(next);
    } else {
      i18n.changeLanguage(value);
    }
  };

  return (
    <motion.aside
      className="flex w-full flex-col border-b border-[var(--ink)] bg-[var(--paper)] md:w-64 md:border-r md:border-b-0"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <motion.div
        className="flex h-14 items-center border-b border-[var(--ink)] px-5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut", delay: 0.04 }}
      >
        <span className="vi-display text-xl">
          Video <em className="text-[var(--accent)]">Insight</em>
        </span>
      </motion.div>
      <nav className="flex gap-2 overflow-x-auto p-3 md:flex-1 md:flex-col md:space-y-1 md:gap-0">
        {navItems.map(({ to, labelKey, icon: Icon }, index) => {
          const isActive =
            to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(to);
          return (
            <motion.div
              key={to}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, ease: "easeOut", delay: 0.08 + index * 0.04 }}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
            >
              <Link
                to={to}
                className={cn(
                  "relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                  isActive
                    ? "text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--rule-soft)] hover:text-[var(--ink)]",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-nav"
                    className="absolute inset-0 rounded-lg bg-[rgba(192,81,47,0.08)]"
                    transition={{ duration: 0.22, ease: "easeOut" }}
                  />
                )}
                <Icon className="relative z-10 h-4 w-4" />
                <span className="relative z-10">{t(labelKey)}</span>
              </Link>
            </motion.div>
          );
        })}
      </nav>
      <motion.div
        className="hidden border-t border-[var(--rule)] p-5 md:block"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut", delay: 0.16 }}
      >
        <p className="vi-kicker">{t("settings.title")}</p>
        <label className="vi-label mt-3 block">
          {t("settings.language.title")}
          <select
            value={currentChoice}
            onChange={handleLanguageChange}
            className="vi-select mt-1 text-sm normal-case"
          >
            <option value="system">{t("settings.language.system")}</option>
            <option value="en">{t("settings.language.en")}</option>
            <option value="zh">{t("settings.language.zh")}</option>
          </select>
        </label>
      </motion.div>
    </motion.aside>
  );
}
