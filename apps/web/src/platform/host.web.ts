import { tokenStorage, type HostServices } from "@videoinsight/ui";

export const webHost: HostServices = {
  kind: "web",
  api: {
    baseUrl: import.meta.env.VITE_API_URL ?? "",
    getToken: () => tokenStorage.get(),
  },
  capabilities: {
    auth: true,
    annotate: true,
    cache: false,
    openLocal: false,
    classroom: false,
  },
};
