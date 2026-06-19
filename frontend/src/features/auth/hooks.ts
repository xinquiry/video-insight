import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { fetchMe, login, register } from "./api";

export function getStoredToken() {
  return localStorage.getItem(apiClient.tokenKey);
}

export function storeToken(token: string) {
  localStorage.setItem(apiClient.tokenKey, token);
}

export function clearToken() {
  localStorage.removeItem(apiClient.tokenKey);
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: Boolean(getStoredToken()),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      storeToken(data.access_token);
      queryClient.setQueryData(["me"], data.user);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: (data) => {
      storeToken(data.access_token);
      queryClient.setQueryData(["me"], data.user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return () => {
    clearToken();
    queryClient.clear();
  };
}
