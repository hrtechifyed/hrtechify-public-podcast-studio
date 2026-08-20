import { MAX_ACTIVE_SHOWS_PER_USER } from "@hrtechify/shared";
import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import {
  dismissBrandSetupPrompt,
  ensureShowPreferences,
  ensureUserOnboarding,
  updateDefaultEpisodeName,
} from "./onboarding";
import {
  archiveShowForUser,
  countActiveShowsForUser,
  createShowForUser,
  deleteShowForUser,
  getShowForUser,
  listShowsForUser,
  restoreShowForUser,
  ShowLimitError,
  updateShowForUser,
} from "./shows";
import { upsertUserFromIdentity } from "./users";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
};

const serializeShow = (show: Awaited<ReturnType<typeof getShowForUser>>) => {
  if (!show) return null;
  return {
    id: show.id,
    name: show.name,
    hostName: show.host_display_name,
    description: show.description,
    status: show.status,
    storageConnectionId: show.storage_connection_id,
    createdAt: show.created_at,
    updatedAt: show.updated_at,
  };
};

export const handleProtectedApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/account") && !url.pathname.startsWith("/api/shows")) {
    return null;
  }

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);

    if (user.status !== "active") {
      return json({ error: "account_not_active" }, 403);
    }

    if (url.pathname === "/api/account" && request.method === "GET") {
      const onboarding = await ensureUserOnboarding(db, identity.userId);
      return json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          status: user.status,
        },
        onboarding,
      });
    }

    if (url.pathname === "/api/account/onboarding/dismiss-brand-prompt" && request.method === "POST") {
      await ensureUserOnboarding(db, identity.userId);
      const onboarding = await dismissBrandSetupPrompt(db, identity.userId);
      return json({ ok: true, onboarding });
    }

    if (url.pathname === "/api/shows" && request.method === "GET") {
      await ensureUserOnboarding(db, identity.userId);
      const [shows, activeCount] = await Promise.all([
        listShowsForUser(db, identity.userId),
        countActiveShowsForUser(db, identity.userId),
      ]);

      return json({
        shows: shows.map((show) => serializeShow(show)),
        limits: {
          active: activeCount,
          maximum: MAX_ACTIVE_SHOWS_PER_USER,
          canCreate: activeCount < MAX_ACTIVE_SHOWS_PER_USER,
        },
      });
    }

    if (url.pathname === "/api/shows" && request.method === "POST") {
      const body = await parseBody(request);
      const show = await createShowForUser(db, identity.userId, {
        name: String(body.name ?? ""),
        hostDisplayName: String(body.hostDisplayName ?? ""),
        description: typeof body.description === "string" ? body.description : undefined,
      });
      await ensureShowPreferences(db, show);
      return json({ show: serializeShow(show) }, 201);
    }

    const preferencesMatch = url.pathname.match(/^\/api\/shows\/([^/]+)\/preferences$/);
    if (preferencesMatch) {
      const showId = decodeURIComponent(preferencesMatch[1]);
      const show = await getShowForUser(db, identity.userId, showId);
      if (!show) return json({ error: "show_not_found" }, 404);

      if (request.method === "GET") {
        const preferences = await ensureShowPreferences(db, show);
        return json({
          preferences: {
            defaultEpisodeName: preferences?.default_episode_name ?? "HRPodcast",
          },
        });
      }

      if (request.method === "PUT" || request.method === "PATCH") {
        const body = await parseBody(request);
        const defaultEpisodeName = await updateDefaultEpisodeName(
          db,
          show,
          body.defaultEpisodeName,
        );
        return json({ preferences: { defaultEpisodeName } });
      }

      return json({ error: "method_not_allowed" }, 405);
    }

    const match = url.pathname.match(/^\/api\/shows\/([^/]+)(?:\/(archive|restore))?$/);
    if (match) {
      const showId = decodeURIComponent(match[1]);
      const action = match[2];

      if (!action && request.method === "GET") {
        const show = await getShowForUser(db, identity.userId, showId);
        if (!show) return json({ error: "show_not_found" }, 404);
        return json({ show: serializeShow(show) });
      }

      if (!action && (request.method === "PUT" || request.method === "PATCH")) {
        const body = await parseBody(request);
        const show = await updateShowForUser(db, identity.userId, showId, {
          name: String(body.name ?? ""),
          hostDisplayName: String(body.hostDisplayName ?? ""),
          description: typeof body.description === "string" ? body.description : undefined,
        });
        if (!show) return json({ error: "show_not_found" }, 404);
        await ensureShowPreferences(db, show);
        return json({ show: serializeShow(show) });
      }

      if (!action && request.method === "DELETE") {
        const deleted = await deleteShowForUser(db, identity.userId, showId);
        if (!deleted) return json({ error: "show_not_found" }, 404);
        return json({ ok: true, filesDeleted: false });
      }

      if (action === "archive" && request.method === "POST") {
        const archived = await archiveShowForUser(db, identity.userId, showId);
        if (!archived) return json({ error: "show_not_found" }, 404);
        return json({ ok: true });
      }

      if (action === "restore" && request.method === "POST") {
        const show = await restoreShowForUser(db, identity.userId, showId);
        if (!show) return json({ error: "show_not_found" }, 404);
        await ensureShowPreferences(db, show);
        return json({ show: serializeShow(show) });
      }
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") {
        return json({ error: error.code }, 503);
      }
      return json({ error: error.code }, 401);
    }

    if (error instanceof ShowLimitError) {
      return json(
        {
          error: "active_show_limit_reached",
          maximum: MAX_ACTIVE_SHOWS_PER_USER,
        },
        409,
      );
    }

    if (error instanceof Error) {
      if (error.message === "d1_not_configured") {
        return json({ error: "d1_not_configured" }, 503);
      }
      if (error.message === "onboarding_schema_not_ready") {
        return json({ error: "onboarding_schema_not_ready" }, 503);
      }
      if (error.message === "invalid_json") {
        return json({ error: "invalid_json" }, 400);
      }
      if (error.message === "authenticated_user_not_found") {
        return json({ error: "authentication_required" }, 401);
      }
      if (error.message.endsWith("_required") || error.message.endsWith("_too_long")) {
        return json({ error: error.message }, 400);
      }
    }

    return json({ error: "internal_error" }, 500);
  }
};
