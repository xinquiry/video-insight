import { createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { HostServices } from "@/platform/host";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";
import { loginRoute } from "@/routes/login";
import { classroomRoute } from "@/routes/classroom";
import { videoDetailRoute } from "@/routes/videos/$videoId";
import { videosIndexRoute } from "@/routes/videos/index";

export function createAppRouter(host: HostServices, queryClient: QueryClient) {
  const { auth, annotate, classroom } = host.capabilities;

  const onlineTree = auth
    ? [indexRoute, videosIndexRoute, videoDetailRoute].concat(annotate ? [] : [])
    : [];
  const classroomTree = classroom ? [classroomRoute] : [];

  // 离线桌面没有 dashboard,把 `/` 重定向到课堂路由。
  const homeRedirect =
    !auth && classroom
      ? [
          createRoute({
            getParentRoute: () => rootRoute,
            path: "/",
            beforeLoad: () => {
              throw redirect({ to: "/classroom" });
            },
          }),
        ]
      : [];

  const routeTree = rootRoute.addChildren([
    ...onlineTree,
    ...classroomTree,
    ...homeRedirect,
    loginRoute,
  ]);

  return createRouter({
    routeTree,
    context: { host, queryClient },
    defaultPreload: "intent",
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
