import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import {
  getEpisodeForUser,
  listEpisodesForShow,
  updateEpisodeTitleForUser,
  type EpisodeRow,
} from "./episodes";
import { isEpisodeSchemaReady } from "./schema-readiness";
import { getShowForUser } from "./shows";
import { upsertUserFromIdentity } from "./users";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const serializeEpisode = (episode: EpisodeRow) => ({
  id: episode.id,
  showId: episode.show_id,
  title: episode.title,
  status: episode.status,
  source: {
    provider: episode.source_provider,
    storageConnectionId: episode.source_storage_connection_id,
    fileId: episode.source_file_id,
    fileName: episode.source_file_name,
    mimeType: episode.source_mime_type,
    sizeBytes: episode.source_size_bytes,
    immutable: episode.source_immutable === 1,
  },
  createdAt: episode.created_at,
  updatedAt: episode.updated_at,
});

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
};

export const handleEpisodeApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/episodes")) return null;

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);

    if (!(await isEpisodeSchemaReady(db))) {
      return json({ error: "episode_schema_not_ready" }, 503);
    }

    if (url.pathname === "/api/episodes") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const showId = url.searchParams.get("showId")?.trim() ?? "";
      if (!showId) return json({ error: "show_id_required" }, 400);
      const show = await getShowForUser(db, identity.userId, showId);
      if (!show) return json({ error: "show_not_found" }, 404);
      const episodes = await listEpisodesForShow(db, identity.userId, show.id);
      return json({ episodes: episodes.map(serializeEpisode) });
    }

    const match = url.pathname.match(/^\/api\/episodes\/([^/]+)$/);
    if (!match) return json({ error: "not_found" }, 404);
    const episodeId = decodeURIComponent(match[1]);

    if (request.method === "GET") {
      const episode = await getEpisodeForUser(db, identity.userId, episodeId);
      if (!episode) return json({ error: "episode_not_found" }, 404);
      return json({ episode: serializeEpisode(episode) });
    }

    if (request.method === "PATCH") {
      const body = await parseBody(request);
      if (typeof body.title !== "string") return json({ error: "episode_title_required" }, 400);
      const episode = await updateEpisodeTitleForUser(db, identity.userId, episodeId, body.title);
      if (!episode) return json({ error: "episode_not_found" }, 404);
      return json({ episode: serializeEpisode(episode) });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") return json({ error: error.code }, 503);
      return json({ error: error.code }, 401);
    }
    if (error instanceof Error) {
      if (error.message === "d1_not_configured") return json({ error: error.message }, 503);
      if (error.message === "invalid_json") return json({ error: error.message }, 400);
      if (error.message.endsWith("_required") || error.message.endsWith("_too_long")) {
        return json({ error: error.message }, 400);
      }
    }
    return json({ error: "internal_error" }, 500);
  }
};
