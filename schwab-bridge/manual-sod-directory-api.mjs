import { isAllowedLocalOrigin } from "./local-origin.mjs";
import {
  DEFAULT_MANUAL_SOD_ROOT,
  readManualSodCandidatePackage,
} from "./manual-sod-directory-reader.mjs";

function json(res, statusCode, value, origin = null) {
  const body = JSON.stringify(value);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  };
  if (origin && isAllowedLocalOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function statusForError(error) {
  if (error?.code === "MANUAL_SOD_SOURCE_DATE_INVALID") return 400;
  if (["MANUAL_SOD_ROOT_NOT_FOUND", "MANUAL_SOD_PACKAGE_NOT_FOUND"].includes(error?.code)) return 404;
  if (String(error?.code || "").startsWith("MANUAL_SOD_")) return 422;
  return 500;
}

export function createManualSodDirectoryApiHandler({ rootPath = DEFAULT_MANUAL_SOD_ROOT } = {}) {
  return async function handleManualSodDirectoryApi(req, res) {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/api/manual-sod/candidates") return false;

    const origin = req.headers.origin || null;
    if (origin && !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "origin not allowed", code: "ORIGIN_NOT_ALLOWED" });
      return true;
    }
    if (req.method !== "GET") {
      json(res, 405, { error: "method not allowed", code: "METHOD_NOT_ALLOWED" }, origin);
      return true;
    }

    try {
      const sourceDates = requestUrl.searchParams.getAll("sourceDate");
      const result = await readManualSodCandidatePackage({
        rootPath,
        sourceDate: sourceDates.length === 1 ? sourceDates[0] : null,
      });
      json(res, 200, result, origin);
    } catch (error) {
      json(res, statusForError(error), {
        error: error?.message || "The manual SOD package could not be read.",
        code: error?.code || "MANUAL_SOD_DIRECTORY_ERROR",
      }, origin);
    }
    return true;
  };
}
