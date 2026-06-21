import { apiClient } from "@/lib/api-client";
import type { AuthToken, Group, User } from "@/types";

export function login(data: { username: string; password: string }) {
  return apiClient.post<AuthToken>("/api/auth/login", data);
}

export function createUser(data: {
  username: string;
  password: string;
  group_id: string;
}) {
  return apiClient.post<User>("/api/auth/users", data);
}

export function fetchMe() {
  return apiClient.get<User>("/api/auth/me");
}

export function fetchGroups() {
  return apiClient.get<Group[]>("/api/groups");
}

export function createGroup(data: { name: string }) {
  return apiClient.post<Group>("/api/groups", data);
}
