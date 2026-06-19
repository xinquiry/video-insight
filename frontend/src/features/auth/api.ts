import { apiClient } from "@/lib/api-client";
import type { AuthToken, User } from "@/types";

export function login(data: { username: string; password: string }) {
  return apiClient.post<AuthToken>("/api/auth/login", data);
}

export function register(data: { username: string; password: string }) {
  return apiClient.post<AuthToken>("/api/auth/register", data);
}

export function fetchMe() {
  return apiClient.get<User>("/api/auth/me");
}
