import { MAX_SHOWS_PER_USER } from "@hrtechify/shared";
import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import {
  createEpisodeForShow,
  listEpisodesForShow,
  serializeEpisode,
} from "./episodes";
import {
  countShowsForUser,
  createShowForUser,
  deleteShowForUser,
  getShowForUser,
  listShowsForUser,
  saveGoogleDriveWorkspaceForShow,
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
    driveShowFolderId: show.drive_show_folder_id,
    driveEpisodesFolderId: show.drive_episodes_folder_id,
    createdAt: show.created_at,
    updatedAt: show.updated_at,
  };
};

export const handleProtectedApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (url.pathname !== "/api/account" && !url.pathname.startsWith("/api/shows")) {
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
      return json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          status: user.status,
        },
      });
    }

    if (url.pathname === "/api/shows" && request.method === "GET") {
      const [shows, used] = await Promise.all([
        listShowsForUser(db, identity.userId),
        countShowsForUser(db, identity.userId),
      ]);

      return json({
        shows: shows.map((show) => serializeShow(show)),
        limits: {
          used,
          maximum: MAX_SHOWS_PER_USER,
          canCreate: used < MAX_SHOWS_PER_USER,
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
      return json({ show: serializeShow(show) }, 201);
    }

    const episodesMatch = url.pathname.match(/^\/api\/shows\/([^/]+)\/episodes$/);
    if (episodesMatch) {
      const showId = decodeURIComponent(episodesMatch[1]);
      if (request.method === "GET") {
        const episodes = await listEpisodesForShow(db, identity.userId, showId);
        if (!episodes) return json({ error: "show_not_found" }, 404);
        return json({ episodes: episodes.map(serializeEpisode) });
      }
      if (request.method === "POST") {
        const body = await parseBody(request);
        const episode = await createEpisodeForShow(db, identity.userId, showId, {
          id: typeof body.id === "string" ? body.id : undefined,
          title: String(body.title ?? ""),
          sourceKind: String(body.sourceKind ?? "") as "upload" | "recording",
          sourceFileId: String(body.sourceFileId ?? ""),
          sourceFileName: String(body.sourceFileName ?? ""),
          sourceMimeType: typeof body.sourceMimeType === "string" ? body.sourceMimeType : undefined,
          sourceSizeBytes: typeof body.sourceSizeBytes === "number" ? body.sourceSizeBytes : undefined,
          driveEpisodeFolderId: String(body.driveEpisodeFolderId ?? ""),
          templateId: String(body.templateId ?? ""),
          templateVersion: typeof body.templateVersion === "number" ? body.templateVersion : undefined,
          musicPlan: Array.isArray(body.musicPlan) ? body.musicPlan as never[] : [],
        });
        return json({ episode: serializeEpisode(episode) }, 201);
      }
    }

    const driveMatch = url.pathname.match(/^\/api\/shows\/([^/]+)\/storage\/google-drive$/);
    if (driveMatch && request.method === "PUT") {
      const showId = decodeURIComponent(driveMatch[1]);
      const body = await parseBody(request);
      const show = await saveGoogleDriveWorkspaceForShow(
        db,
        identity.userId,
        showId,
        String(body.showFolderId ?? ""),
        String(body.episodesFolderId ?? ""),
      );
      if (!show) return json({ error: "show_not_found" }, 404);
      return json({ show: serializeShow(show) });
    }

    const showMatch = url.pathname.match(/^\/api\/shows\/([^/]+)$/);
    if (showMatch) {
      const showId = decodeURIComponent(showMatch[1]);

      if (request.method === "GET") {
        const show = await getShowForUser(db, identity.userId, showId);
        if (!show) return json({ error: "show_not_found" }, 404);
        return json({ show: serializeShow(show) });
      }

      if (request.method === "PUT" || request.method === "PATCH") {
        const body = await parseBody(request);
        const show = await updateShowForUser(db, identity.userId, showId, {
          name: String(body.name ?? ""),
          hostDisplayName: String(body.hostDisplayName ?? ""),
          description: typeof body.description === "string" ? body.description : undefined,
        });
        if (!show) return json({ error: "show_not_found" }, 404);
        return json({ show: serializeShow(show) });
      }

      if (request.method === "DELETE") {
        const deleted = await deleteShowForUser(db, identity.userId, showId);
        if (!deleted) return json({ error: "show_not_found" }, 404);
        return json({
          ok: true,
          driveFilesDeleted: false,
          message: "The show was removed from the studio. Its Google Drive folder was left untouched.",
        });
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
          error: "show_limit_reached",
          maximum: MAX_SHOWS_PER_USER,
          message: `You can create up to ${MAX_SHOWS_PER_USER} shows. Delete an existing show before adding another.`,
        },
        409,
      );
    }

    if (error instanceof Error) {
      if (error.message === "d1_not_configured") return json({ error: "d1_not_configured" }, 503);
      if (error.message === "invalid_json") return json({ error: "invalid_json" }, 400);
      if (error.message === "authenticated_user_not_found") return json({ error: "authentication_required" }, 401);
      if (error.message === "show_not_found") return json({ error: "show_not_found" }, 404);
      if (
        error.message.endsWith("_required") ||
        error.message.endsWith("_too_long") ||
        error.message.endsWith("_invalid") ||
        error.message.startsWith("music_") ||
        error.message === "template_not_found" ||
        error.message === "google_drive_workspace_required" ||
        error.message === "throughout_music_must_be_the_only_cue"
      ) {
        return json({ error: error.message }, 400);
      }
    }

    return json({ error: "internal_error" }, 500);
  }
};
