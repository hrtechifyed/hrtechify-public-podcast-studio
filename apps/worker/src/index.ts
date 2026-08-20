import {
  MAX_MUSIC_CUES_PER_EPISODE,
  MAX_SHOWS_PER_USER,
  PLATFORM_CREDIT,
  PLATFORM_CREDIT_POSITION,
} from "@hrtechify/shared";
import type { WorkerEnv } from "./db";
import { handleAuthApi } from "./auth-api";
import { handleProtectedApi } from "./protected-api";

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
        maxShowsPerUser: MAX_SHOWS_PER_USER,
        maxMusicCuesPerEpisode: MAX_MUSIC_CUES_PER_EPISODE,
        platformCredit: PLATFORM_CREDIT,
        platformCreditPosition: PLATFORM_CREDIT_POSITION,
        googleDriveClientId: env.GOOGLE_AUTH_CLIENT_ID ?? null,
        googleDriveScope: "https://www.googleapis.com/auth/drive.file",
      });
    }

    const authResponse = await handleAuthApi(request, url, env);
    if (authResponse) return authResponse;

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
