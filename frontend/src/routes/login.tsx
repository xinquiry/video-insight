import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogIn, UserPlus } from "lucide-react";
import { useState } from "react";
import { useLogin, useRegister } from "@/features/auth/hooks";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const register = useRegister();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const mutation = mode === "login" ? login : register;
    mutation.mutate(
      { username, password },
      { onSuccess: () => navigate({ to: "/" }) },
    );
  };

  const isPending = login.isPending || register.isPending;
  const hasError = login.isError || register.isError;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-gray-950">
            VideoInsight
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign in to manage shared learning videos.
          </p>
        </div>

        <div className="grid grid-cols-2 rounded-md border border-gray-300 p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
              mode === "login"
                ? "bg-[var(--color-primary)] text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <LogIn className="h-4 w-4" />
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
              mode === "register"
                ? "bg-[var(--color-primary)] text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <UserPlus className="h-4 w-4" />
            Register
          </button>
        </div>

        <label className="block text-sm font-medium text-gray-700">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            minLength={3}
            required
          />
        </label>

        <label className="block text-sm font-medium text-gray-700">
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            minLength={8}
            type="password"
            required
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
        >
          {mode === "login" ? (
            <LogIn className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {isPending ? "Working..." : mode === "login" ? "Login" : "Register"}
        </button>

        {hasError && (
          <p className="text-sm text-red-600">
            {mode === "login"
              ? "Invalid username or password."
              : "Registration failed. Try a different username."}
          </p>
        )}
      </form>
    </main>
  );
}
