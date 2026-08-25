const API_URL = import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "videoinsight_token";

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
    }
    throw new Error(`${response.status}: ${body}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
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
    const response = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
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
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
    const response = await fetch(`${API_URL}${path}`, {
      headers: authHeaders(),
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async postForm<T>(path: string, body: FormData): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    return handleResponse<T>(response);
  },

  download,
};
