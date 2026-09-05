import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tokenStorage } from "@/platform/api-client";
import { createGroup, createUser, fetchGroups, fetchMe, login } from "./api";

export function getStoredToken() {
  return tokenStorage.get();
}

export function storeToken(token: string) {
  tokenStorage.set(token);
}

export function clearToken() {
  tokenStorage.clear();
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

export function useCreateUser() {
  return useMutation({
    mutationFn: createUser,
  });
}

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: ["groups"],
    queryFn: fetchGroups,
    enabled,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
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
