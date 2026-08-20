import { AuthenticationError, requireVerifiedIdentity } from "./auth";
import { requireDatabase, type WorkerEnv } from "./db";
import { getEpisodeForUser } from "./episodes";
import {
  ensureEpisodePublishPreferences,
  listSafePublishTemplates,
  updateEpisodePublishPreferences,
} from "./publish-preferences";
import {
  isEpisodeSchemaReady,
  isPublishPreferenceSchemaReady,
} from "./schema-readiness";
import { upsertUserFromIdentity } from "./users";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const serialize = (row: Awaited<ReturnType<typeof ensureEpisodePublishPreferences>>) => ({
  episodeId: row.episode_id,
  templateId: row.template_id,
  templateVersion: row.template_version,
  captionsEnabled: row.captions_enabled === 1,
  updatedAt: row.updated_at,
});

export const handlePublishPreferencesApi = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | null> => {
  const match = url.pathname.match(/^\/api\/episodes\/([^/]+)\/publish-preferences$/);
  if (!match) return null;

  try {
    const identity = await requireVerifiedIdentity(request, env);
    const db = requireDatabase(env);
    const user = await upsertUserFromIdentity(db, identity);
    if (user.status !== "active") return json({ error: "account_not_active" }, 403);
    if (!(await isEpisodeSchemaReady(db)) || !(await isPublishPreferenceSchemaReady(db))) {
      return json({ error: "publish_preferences_schema_not_ready" }, 503);
    }

    const episodeId = decodeURIComponent(match[1]);
    const episode = await getEpisodeForUser(db, identity.userId, episodeId);
    if (!episode) return json({ error: "episode_not_found" }, 404);

    if (request.method === "GET") {
      const preferences = await ensureEpisodePublishPreferences(db, identity.userId, episode);
      return json({
        preferences: serialize(preferences),
        templates: listSafePublishTemplates(),
      });
    }

    if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
    if (["rendering", "completed", "cancelled"].includes(episode.status)) {
      return json({ error: "publish_preferences_locked" }, 409);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const updated = await updateEpisodePublishPreferences(db, identity.userId, episode, {
      templateId: body.templateId,
      captionsEnabled: body.captionsEnabled,
    });
    return json({ preferences: serialize(updated), templates: listSafePublishTemplates() });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === "authentication_not_configured") return json({ error: error.code }, 503);
      return json({ error: error.code }, 401);
    }
    if (error instanceof Error) {
      if (error.message === "d1_not_configured") return json({ error: error.message }, 503);
      if (error.message === "episode_not_found") return json({ error: error.message }, 404);
      if (
        error.message.startsWith("template_") ||
        error.message.startsWith("captions_") ||
        error.message.startsWith("publish_preferences_")
      ) {
        return json({ error: error.message }, 400);
      }
    }
    return json({ error: "internal_error" }, 500);
  }
};
