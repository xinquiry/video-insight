import { Navigate, Outlet, createRootRouteWithContext, useLocation } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { getStoredToken, useMe } from "@/features/auth/hooks";
import type { HostServices } from "@/platform/host";
import { useHost } from "@/platform/host";

export type RouterContext = {
  host: HostServices;
  queryClient: QueryClient;
};

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const location = useLocation();
  const host = useHost();
  const { auth } = host.capabilities;
  const token = getStoredToken();
  const { isError, isLoading } = useMe();

  if (location.pathname === "/login") {
    return <Outlet />;
  }

  // 离线宿主(桌面未登录)不做登录守卫,直接进入课堂等本地路由。
  if (!auth) {
    return (
      <AppLayout>
        <Outlet />
      </AppLayout>
    );
  }

  if (!token || isError) {
    return <Navigate to="/login" />;
  }
  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--paper)] text-sm text-[var(--muted)]">
        Loading...
      </main>
    );
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
