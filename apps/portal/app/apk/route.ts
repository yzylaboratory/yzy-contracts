const DEV_HOSTNAME = "yzycontracts.yzylabs.dev";
const ANDROID_DOWNLOAD_PATH = "/api/v1/mobile/android";

export const dynamic = "force-dynamic";

// /apk downloads the current Android app. The API answers with a temporary link to the file.
// DEV serves the API on the portal's own origin; production on NEXT_PUBLIC_API_URL.
export function GET(request: Request): Response {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const location = host === DEV_HOSTNAME ? ANDROID_DOWNLOAD_PATH : apiUrl ? new URL(ANDROID_DOWNLOAD_PATH, apiUrl).toString() : null;
  if (!location) {
    return new Response("La descarga no está disponible.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}
