import { AppRoot } from "@videoinsight/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@videoinsight/ui/styles.css";
import "@videoinsight/ui/i18n";
import { webHost } from "./platform/host.web";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot host={webHost} />
  </StrictMode>,
);
