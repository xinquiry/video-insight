import type { ClassButtonApi } from "../shared/contracts";

declare module "*.css";

declare global {
  interface Window {
    classButton: ClassButtonApi;
  }
}

export {};
