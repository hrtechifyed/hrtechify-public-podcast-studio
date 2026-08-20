import {
  MAX_ACTIVE_SHOWS_PER_USER,
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
} from "@hrtechify/shared";
import type { WorkerEnv } from "./db";
import { handleAuthApi } from "./auth-api";
import { handleBackgroundRemovalApi } from "./background-removal-api";
import { handleBrandAssetsApi } from "./brand-assets-api";
import { handleBrandMediaApi } from "./brand-media-api";
import { handleDriveFileApi } from "./drive-file-api";
import { handleEditorialEditsApi } from "./editorial-edits-api";
import { handleEpisodeApi } from "./episode-api";
import { handlePasswordAuthApi } from "./password-auth-api";
import { handleProtectedApi } from "./protected-api";
import { handlePublishPreferencesApi } from "./publish-preferences-api";
import { handleRenderApi } from "./render-api";
import { handleStorageApi } from "./storage-api";

export { PodcastRenderContainer, ContainerProxy } from "./render-container";
export { PodcastRenderWorkflow } from "./render-workflow";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "hrtechify-public-podcast-studio-api",
      });
    }

    if (url.pathname === "/api/config") {
      return json({
        maxActiveShowsPerUser: MAX_ACTIVE_SHOWS_PER_USER,
        platformCredit: PLATFORM_CREDIT,
        platformCreditPosition: PLATFORM_CREDIT_POSITION,
      });
    }

    const passwordAuthResponse = await handlePasswordAuthApi(request, url, env);
    if (passwordAuthResponse) return passwordAuthResponse;

    const authResponse = await handleAuthApi(request, url, env);
    if (authResponse) return authResponse;

    const brandMediaResponse = await handleBrandMediaApi(request, url, env);
    if (brandMediaResponse) return brandMediaResponse;

    const backgroundRemovalResponse = await handleBackgroundRemovalApi(request, url, env);
    if (backgroundRemovalResponse) return backgroundRemovalResponse;

    const brandAssetsResponse = await handleBrandAssetsApi(request, url, env);
    if (brandAssetsResponse) return brandAssetsResponse;

    const driveFileResponse = await handleDriveFileApi(request, url, env);
    if (driveFileResponse) return driveFileResponse;

    const editorialEditsResponse = await handleEditorialEditsApi(request, url, env);
    if (editorialEditsResponse) return editorialEditsResponse;

    const publishPreferencesResponse = await handlePublishPreferencesApi(request, url, env);
    if (publishPreferencesResponse) return publishPreferencesResponse;

    const renderResponse = await handleRenderApi(request, url, env);
    if (renderResponse) return renderResponse;

    const episodeResponse = await handleEpisodeApi(request, url, env);
    if (episodeResponse) return episodeResponse;

    const storageResponse = await handleStorageApi(request, url, env);
    if (storageResponse) return storageResponse;

    const protectedResponse = await handleProtectedApi(request, url, env);
    if (protectedResponse) return protectedResponse;

    return json(
      {
        error: "not_found",
        message: "Route not found.",
      },
      404,
    );
  },
};
