import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const uiSrc = path.resolve(dirname, "../../packages/ui/src");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    base: "./",
    plugins: [react(), tailwindcss()],
    resolve: {
      // 让 @videoinsight/ui 内部的 @/ 导入解析到共享包源码。
      alias: [{ find: /^@\//, replacement: `${uiSrc}/` }],
    },
  },
});
