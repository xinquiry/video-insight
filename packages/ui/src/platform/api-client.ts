const TOKEN_KEY = "videoinsight_token";

type ErrorResponse = {
  code?: string;
  detail?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 后端接入配置,由宿主(web/desktop)注入。
 * 桌面未登录时 baseUrl 可为空串、tokenProvider 返回 null。
 */
export type ApiConfig = {
  baseUrl: string;
  tokenProvider(): string | null;
  onUnauthorized?(): void;
};

let config: ApiConfig = {
  baseUrl: "",
  tokenProvider: () => localStorage.getItem(TOKEN_KEY),
};

export function configureApiClient(next: ApiConfig) {
  config = next;
}

export const tokenStorage = {
  key: TOKEN_KEY,
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function readErrorResponse(response: Response): Promise<ErrorResponse> {
  const body = await response.text();
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") {
      const value = parsed as Record<string, unknown>;
      return {
        code: typeof value.code === "string" ? value.code : undefined,
        detail: typeof value.detail === "string" ? value.detail : undefined,
      };
    }
  } catch {
    // Preserve a short plain-text response from a proxy or upstream service.
  }
  return { detail: body.length <= 500 ? body : undefined };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await readErrorResponse(response);
    if (response.status === 401) {
      config.onUnauthorized?.();
    }
    throw new ApiError(
      response.status,
      body.code ?? null,
      body.detail || response.statusText || "Request failed",
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function authHeaders(): Record<string, string> {
  const token = config.tokenProvider();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function url(path: string): string {
  return `${config.baseUrl}${path}`;
}

type SaveFileHandle = {
  createWritable(): Promise<FileSystemWritableFileStream>;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<SaveFileHandle>;
};

async function download(path: string, suggestedName: string, contentType: string) {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  let writable: FileSystemWritableFileStream | undefined;
  if (picker) {
    const handle = await picker.call(window, {
      suggestedName,
      types: [{ description: "VideoInsight package", accept: { [contentType]: [".vinsight"] } }],
    });
    writable = await handle.createWritable();
  }

  try {
    const response = await fetch(url(path), { headers: authHeaders() });
    if (!response.ok) return await handleResponse<never>(response);
    if (writable) {
      if (response.body) {
        await response.body.pipeTo(writable);
      } else {
        await writable.write(await response.blob());
        await writable.close();
      }
      return;
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = suggestedName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  } catch (error) {
    try {
      await writable?.abort();
    } catch {
      // Preserve the download error if cleanup also fails.
    }
    throw error;
  }
}

export const apiClient = {
  tokenKey: TOKEN_KEY,

  async get<T>(path: string): Promise<T> {
    const response = await fetch(url(path), {
      headers: authHeaders(),
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async postForm<T>(path: string, body: FormData): Promise<T> {
    const response = await fetch(url(path), {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(url(path), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const response = await fetch(url(path), {
      method: "DELETE",
      headers: authHeaders(),
    });
    return handleResponse<T>(response);
  },

  download,
};
