import { Link, useLocation } from "@tanstack/react-router";
import { Home, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/videos", label: "Videos", icon: Video },
] as const;

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="flex w-full flex-col border-b border-[var(--ink)] bg-[var(--paper)] md:w-64 md:border-r md:border-b-0">
      <div className="flex h-14 items-center border-b border-[var(--ink)] px-5">
        <span className="vi-display text-xl">
          Video <em className="text-[var(--accent)]">Insight</em>
        </span>
      </div>
      <nav className="flex gap-2 overflow-x-auto p-3 md:flex-1 md:flex-col md:space-y-1 md:gap-0">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-[rgba(192,81,47,0.08)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--rule-soft)] hover:text-[var(--ink)]",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-[var(--rule)] p-5 md:block">
        <p className="vi-kicker">Edition</p>
        <p className="vi-display mt-2 text-lg">Annotated learning archive</p>
      </div>
    </aside>
  );
}
