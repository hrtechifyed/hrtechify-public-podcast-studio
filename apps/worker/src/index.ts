import {
  MAX_ACTIVE_SHOWS_PER_USER,
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
} from "@hrtechify/shared";
import type { WorkerEnv } from "./db";
import { handleAccountPrivacyApi } from "./account-privacy-api";
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
import { applySecurityHeaders, enforceRequestSecurity, securityConfiguration } from "./security";
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
    const finalize = (response: Response) => applySecurityHeaders(response, request);
    const securityRejection = enforceRequestSecurity(request, env);
    if (securityRejection) return finalize(securityRejection);

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return finalize(json({
        ok: true,
        service: "hrtechify-public-podcast-studio-api",
      }));
    }

    if (url.pathname === "/api/config") {
      return finalize(json({
        maxActiveShowsPerUser: MAX_ACTIVE_SHOWS_PER_USER,
        platformCredit: PLATFORM_CREDIT,
        platformCreditPosition: PLATFORM_CREDIT_POSITION,
        security: securityConfiguration,
      }));
    }

    const handlers = [
      handlePasswordAuthApi,
      handleAuthApi,
      handleAccountPrivacyApi,
      handleBrandMediaApi,
      handleBackgroundRemovalApi,
      handleBrandAssetsApi,
      handleDriveFileApi,
      handleEditorialEditsApi,
      handlePublishPreferencesApi,
      handleRenderApi,
      handleEpisodeApi,
      handleStorageApi,
      handleProtectedApi,
    ] as const;

    for (const handler of handlers) {
      const response = await handler(request, url, env);
      if (response) return finalize(response);
    }

    return finalize(json(
      {
        error: "not_found",
        message: "Route not found.",
      },
      404,
    ));
  },
};
