import { AppRoot } from "@videoinsight/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@videoinsight/ui/styles.css";
import "@videoinsight/ui/i18n";
import { createDesktopHost } from "./platform/host.desktop";

// 桌面后端地址由构建/运行环境注入;缺省保持离线课堂模式。
const host = createDesktopHost({ apiBaseUrl: import.meta.env.VITE_API_URL ?? "" });

const root = document.getElementById("root");
if (!root) throw new Error("missing React root");

createRoot(root).render(
  <StrictMode>
    <AppRoot host={host} />
  </StrictMode>,
);
