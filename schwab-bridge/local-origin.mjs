export function isAllowedLocalOrigin(origin) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
