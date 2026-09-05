import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { createAppRouter } from "./router";
import { configureApiClient } from "@/platform/api-client";
import { type HostServices, HostProvider } from "@/platform/host";

export function AppRoot({ host }: { host: HostServices }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
    [],
  );

  // 把宿主的后端接入注入 api-client,再构建按能力裁剪的路由。
  useEffect(() => {
    configureApiClient({
      baseUrl: host.api?.baseUrl ?? "",
      tokenProvider: () => host.api?.getToken() ?? null,
      onUnauthorized: () => {
        // 由各宿主凭据模块负责清理 token。
      },
    });
  }, [host]);

  const router = useMemo(() => createAppRouter(host, queryClient), [host, queryClient]);

  return (
    <HostProvider value={host}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </HostProvider>
  );
}
