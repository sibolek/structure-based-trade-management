import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SOD_CHART_CONTENT_REF_PREFIX = "sod-chart:";
export const SOD_CHART_STORE_SCHEMA_VERSION = 1;
export const MAX_SOD_CHART_BYTES = 8 * 1024 * 1024;

const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{7,127}$/;

function text(value) {
  return String(value ?? "").trim();
}

function chartError(message, code = "SOD_CHART_STORE_ERROR", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function bytesFrom(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw chartError("SOD chart bytes are required", "SOD_CHART_BYTES_REQUIRED");
}

function assertMagicBytes(bytes, mediaType) {
  const png = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";

  const valid = mediaType === "image/png" ? png : mediaType === "image/jpeg" ? jpeg : webp;
  if (!valid) {
    throw chartError(
      `Chart bytes do not match declared media type ${mediaType}`,
      "SOD_CHART_MEDIA_SIGNATURE_MISMATCH",
    );
  }
}

function normalizeMediaType(value) {
  const mediaType = text(value).toLowerCase().split(";", 1)[0];
  if (!MEDIA_TYPES.has(mediaType)) {
    throw chartError(
      `Unsupported SOD chart media type ${mediaType || "(empty)"}`,
      "SOD_CHART_MEDIA_TYPE_UNSUPPORTED",
    );
  }
  return mediaType;
}

function sanitizeDisplayName(value) {
  return text(value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240) || "chart";
}

function normalizeId(value) {
  const id = text(value);
  if (!SAFE_ID.test(id)) {
    throw chartError("SOD chart id is invalid", "SOD_CHART_ID_INVALID");
  }
  return id;
}

function refFor(id) {
  return `${SOD_CHART_CONTENT_REF_PREFIX}${id}`;
}

function idFromRef(contentRef) {
  const ref = text(contentRef);
  if (!ref.startsWith(SOD_CHART_CONTENT_REF_PREFIX)) {
    throw chartError("SOD chart contentRef is not orchestrator-issued", "SOD_CHART_REF_INVALID");
  }
  return normalizeId(ref.slice(SOD_CHART_CONTENT_REF_PREFIX.length));
}

function pathsFor(root, id) {
  const safeId = normalizeId(id);
  return {
    data: path.join(root, `${safeId}.bin`),
    metadata: path.join(root, `${safeId}.json`),
    tempData: path.join(root, `.${safeId}.bin.tmp`),
    tempMetadata: path.join(root, `.${safeId}.json.tmp`),
  };
}

async function ensureDirectory(root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw chartError("SOD chart store path must be a directory", "SOD_CHART_STORE_INVALID");
  }
}

async function writeExclusive(pathname, bytes) {
  const handle = await fs.open(pathname, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishExclusive(tempPath, finalPath) {
  await fs.link(tempPath, finalPath);
  await fs.unlink(tempPath).catch(() => {});
}

function publicDescriptor(metadata) {
  return {
    schemaVersion: metadata.schemaVersion,
    chartId: metadata.chartId,
    contentRef: metadata.contentRef,
    mediaType: metadata.mediaType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    displayName: metadata.displayName,
    ingestedAt: metadata.ingestedAt,
  };
}

export function createSodChartStore({
  rootPath,
  clock = () => new Date().toISOString(),
  idFactory = () => crypto.randomUUID(),
  maxBytes = MAX_SOD_CHART_BYTES,
} = {}) {
  const root = path.resolve(text(rootPath));
  if (!text(rootPath)) {
    throw chartError("SOD chart store path is required", "SOD_CHART_STORE_PATH_REQUIRED");
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) {
    throw chartError("SOD chart maxBytes is invalid", "SOD_CHART_MAX_BYTES_INVALID");
  }

  async function ingest({ bytes: inputBytes, mediaType: inputMediaType, displayName = "chart" } = {}) {
    const bytes = bytesFrom(inputBytes);
    if (bytes.length === 0) throw chartError("SOD chart is empty", "SOD_CHART_EMPTY");
    if (bytes.length > maxBytes) {
      throw chartError(`SOD chart exceeds ${maxBytes} byte limit`, "SOD_CHART_TOO_LARGE");
    }
    const mediaType = normalizeMediaType(inputMediaType);
    assertMagicBytes(bytes, mediaType);
    await ensureDirectory(root);

    const id = normalizeId(idFactory());
    const chartId = `chart-${id}`;
    const contentRef = refFor(id);
    const ingestedAt = new Date(text(clock())).toISOString();
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const metadata = {
      schemaVersion: SOD_CHART_STORE_SCHEMA_VERSION,
      chartId,
      contentRef,
      mediaType,
      byteLength: bytes.length,
      sha256,
      displayName: sanitizeDisplayName(displayName),
      ingestedAt,
    };
    const target = pathsFor(root, id);
    let dataPublished = false;
    let metadataPublished = false;

    try {
      await writeExclusive(target.tempData, bytes);
      await publishExclusive(target.tempData, target.data);
      dataPublished = true;

      const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      await writeExclusive(target.tempMetadata, metadataBytes);
      // Exclusive metadata publication is the visibility boundary. Hard-link publication fails on collision.
      await publishExclusive(target.tempMetadata, target.metadata);
      metadataPublished = true;
      return publicDescriptor(metadata);
    } catch (error) {
      await fs.unlink(target.tempData).catch(() => {});
      await fs.unlink(target.tempMetadata).catch(() => {});
      if (dataPublished && !metadataPublished) await fs.unlink(target.data).catch(() => {});
      if (error?.code?.startsWith?.("SOD_CHART_")) throw error;
      if (error?.code === "EEXIST") {
        throw chartError("SOD chart id collision", "SOD_CHART_ID_COLLISION");
      }
      throw chartError(`SOD chart ingest failed: ${error.message}`, "SOD_CHART_INGEST_FAILED", {
        causeCode: error?.code || null,
      });
    }
  }

  async function resolve(contentRef) {
    const id = idFromRef(contentRef);
    const target = pathsFor(root, id);
    let metadata;
    let bytes;
    try {
      const [metadataText, data] = await Promise.all([
        fs.readFile(target.metadata, "utf8"),
        fs.readFile(target.data),
      ]);
      metadata = JSON.parse(metadataText);
      bytes = data;
    } catch (error) {
      throw chartError("SOD chart contentRef is unavailable", "SOD_CHART_REF_UNAVAILABLE", {
        causeCode: error?.code || null,
      });
    }

    const expectedRef = refFor(id);
    const expectedChartId = `chart-${id}`;
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (
      metadata?.schemaVersion !== SOD_CHART_STORE_SCHEMA_VERSION
      || metadata?.contentRef !== expectedRef
      || metadata?.chartId !== expectedChartId
      || !MEDIA_TYPES.has(metadata?.mediaType)
      || metadata?.byteLength !== bytes.length
      || metadata?.sha256 !== sha256
    ) {
      throw chartError("SOD chart store integrity check failed", "SOD_CHART_INTEGRITY_FAILURE");
    }
    assertMagicBytes(bytes, metadata.mediaType);

    return Object.freeze({
      ...publicDescriptor(metadata),
      bytes: Buffer.from(bytes),
    });
  }

  async function assertChartReference(chart) {
    const resolved = await resolve(chart?.contentRef);
    if (text(chart?.chartId) !== resolved.chartId) {
      throw chartError(
        "SOD chartId does not match orchestrator-issued contentRef",
        "SOD_CHART_ID_REF_MISMATCH",
      );
    }
    return resolved;
  }

  return Object.freeze({
    rootPath: root,
    maxBytes,
    ingest,
    resolve,
    assertChartReference,
  });
}
