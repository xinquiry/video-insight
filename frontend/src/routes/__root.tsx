import {
  Navigate,
  Outlet,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { getStoredToken, useMe } from "@/features/auth/hooks";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const location = useLocation();
  const token = getStoredToken();
  const { isError, isLoading } = useMe();

  if (location.pathname === "/login") {
    return <Outlet />;
  }
  if (!token || isError) {
    return <Navigate to="/login" />;
  }
  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
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
