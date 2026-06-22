import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Clock, Film, Plus, Tags, Users, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreateGroup,
  useCreateUser,
  useGroups,
  useMe,
} from "@/features/auth/hooks";
import { useVideos } from "@/features/videos/hooks";
import { formatBytes, formatDate } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation();
  const { data: user } = useMe();
  const { data } = useVideos(1, 5);
  const videos = data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--ink)] pb-8">
        <div>
          <p className="vi-kicker">{t("dashboard.kicker")}</p>
          <h1 className="vi-display mt-3 max-w-3xl text-5xl">
            {t("dashboard.title")}
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-[var(--muted)]">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <Link
          to="/videos"
          className="vi-button-primary"
        >
          <Plus className="h-4 w-4" />
          {t("dashboard.addVideo")}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-0 border-y border-[var(--ink)] sm:grid-cols-3">
        <div className="border-b border-[var(--rule)] p-6 sm:border-r sm:border-b-0">
          <Film className="h-5 w-5 text-[var(--accent)]" />
          <p className="vi-kicker mt-5">{t("dashboard.stats.totalVideos")}</p>
          <p className="vi-display mt-2 text-5xl">{data?.total ?? "..."}</p>
        </div>
        <div className="border-b border-[var(--rule)] p-6 sm:border-r sm:border-b-0">
          <Clock className="h-5 w-5 text-[var(--forest)]" />
          <p className="vi-kicker mt-5">{t("dashboard.stats.recentUploads")}</p>
          <p className="vi-display mt-2 text-5xl">{videos.length}</p>
        </div>
        <div className="p-6">
          <Tags className="h-5 w-5 text-[var(--accent)]" />
          <p className="vi-kicker mt-5">{t("dashboard.stats.annotationModel")}</p>
          <p className="vi-display mt-2 text-3xl">{t("dashboard.stats.shared")}</p>
        </div>
      </div>

      {videos.length > 0 && (
        <div>
          <div className="mb-4 flex items-baseline justify-between border-b border-[var(--ink)] pb-3">
            <h2 className="vi-display text-2xl">{t("dashboard.recent.title")}</h2>
            <span className="vi-mono text-xs text-[var(--muted)]">
              {t("dashboard.recent.latest")}
            </span>
          </div>
          <ul className="vi-panel divide-y divide-[var(--rule)] overflow-hidden">
            {videos.map((video) => (
              <li
                key={video.id}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-[rgba(192,81,47,0.04)]"
              >
                <div>
                  <Link
                    to="/videos/$videoId"
                    params={{ videoId: video.id }}
                    className="vi-display vi-link text-lg"
                  >
                    {video.title}
                  </Link>
                  <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
                    {video.description ?? video.original_filename}
                  </p>
                </div>
                <div className="vi-mono text-right text-xs text-[var(--muted)]">
                  <p>{formatBytes(video.size_bytes)}</p>
                  <p>{formatDate(video.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {user?.is_admin && <AdminCreateUserPanel />}
    </div>
  );
}

function AdminCreateUserPanel() {
  const { t } = useTranslation();
  const createUser = useCreateUser();
  const createGroup = useCreateGroup();
  const { data: groups = [] } = useGroups();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);
  const [createdGroupName, setCreatedGroupName] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId && groups[0]) {
      setGroupId(groups[0].id);
    }
  }, [groupId, groups]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    createUser.mutate(
      { username, password, group_id: groupId },
      {
        onSuccess: (createdUser) => {
          setCreatedUsername(createdUser.username);
          setUsername("");
          setPassword("");
        },
      },
    );
  };

  const submitGroup = (event: React.FormEvent) => {
    event.preventDefault();
    createGroup.mutate(
      { name: groupName },
      {
        onSuccess: (createdGroup) => {
          setCreatedGroupName(createdGroup.name);
          setGroupId(createdGroup.id);
          setGroupName("");
        },
      },
    );
  };

  return (
    <section className="vi-panel grid gap-6 p-5 lg:grid-cols-[1fr_1fr]">
      <div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--rule)] pb-4">
        <div>
          <p className="vi-kicker">{t("dashboard.admin.kicker")}</p>
          <h2 className="vi-display mt-1 text-2xl">{t("dashboard.admin.createAccount")}</h2>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            {t("dashboard.admin.createAccountHint")}
          </p>
        </div>
        <UserPlus className="h-5 w-5 text-[var(--accent)]" />
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-4">
        <label className="vi-label">
          {t("dashboard.admin.username")}
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="vi-input mt-1 text-base normal-case"
            minLength={3}
            maxLength={80}
            required
          />
        </label>
        <label className="vi-label">
          {t("dashboard.admin.group")}
          <select
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className="vi-select mt-1 text-base normal-case"
            required
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="vi-label">
          {t("dashboard.admin.tempPassword")}
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="vi-input mt-1 text-base normal-case"
            minLength={8}
            maxLength={256}
            type="password"
            required
          />
        </label>
        <button
          type="submit"
          disabled={createUser.isPending || !username || !password || !groupId}
          className="vi-button-primary disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          {createUser.isPending ? t("common.creating") : t("dashboard.admin.createButton")}
        </button>
      </form>
      {createdUsername && (
        <p className="mt-4 text-sm text-[var(--forest)]">
          {t("dashboard.admin.created", { username: createdUsername })}
        </p>
      )}
      {createUser.isError && (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {t("dashboard.admin.createError")}
        </p>
      )}
      </div>

      <div>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--rule)] pb-4">
          <div>
            <p className="vi-kicker">{t("dashboard.admin.groupsKicker")}</p>
            <h2 className="vi-display mt-1 text-2xl">{t("dashboard.admin.createGroup")}</h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              {t("dashboard.admin.createGroupHint")}
            </p>
          </div>
          <Users className="h-5 w-5 text-[var(--forest)]" />
        </div>
        <form onSubmit={submitGroup} className="mt-5 grid gap-4">
          <label className="vi-label">
            {t("dashboard.admin.groupName")}
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              className="vi-input mt-1 text-base normal-case"
              minLength={1}
              maxLength={120}
              required
            />
          </label>
          <button
            type="submit"
            disabled={createGroup.isPending || !groupName.trim()}
            className="vi-button-secondary disabled:opacity-50"
          >
            <Users className="h-4 w-4" />
            {createGroup.isPending ? t("common.creating") : t("dashboard.admin.createGroupButton")}
          </button>
        </form>
        {createdGroupName && (
          <p className="mt-4 text-sm text-[var(--forest)]">
            {t("dashboard.admin.createGroupSuccess", { name: createdGroupName })}
          </p>
        )}
        {createGroup.isError && (
          <p className="mt-4 text-sm text-[var(--danger)]">
            {t("dashboard.admin.createGroupError")}
          </p>
        )}
        <div className="mt-5 border-t border-[var(--rule)] pt-4">
          <p className="vi-kicker">{t("dashboard.admin.existingGroups")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {groups.map((group) => (
              <span
                key={group.id}
                className="rounded border border-[var(--rule)] px-2 py-1 text-sm text-[var(--muted)]"
              >
                {group.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
