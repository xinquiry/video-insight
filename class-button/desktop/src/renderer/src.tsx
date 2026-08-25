import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./src/App";
import "./src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing React root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
