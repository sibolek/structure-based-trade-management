import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function text(value) {
  return String(value ?? "").trim();
}

function publisherError(message, code = "SOD_CANDIDATE_PUBLICATION_ERROR", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function safeTimestamp(value) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) {
    throw publisherError("SOD publication requires an exact generatedAt timestamp", "SOD_PUBLICATION_TIMESTAMP_INVALID");
  }
  return new Date(parsed).toISOString().replace(/[:.]/g, "-");
}

export function buildCandidatePublicationPaths({ inboxPath, bundle, publicationId }) {
  const inbox = path.resolve(text(inboxPath));
  if (!text(inboxPath)) {
    throw publisherError("Candidate inbox path is required", "SOD_PUBLICATION_INBOX_REQUIRED");
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw publisherError("Candidate bundle must be a JSON object", "SOD_PUBLICATION_BUNDLE_INVALID");
  }

  const bundleId = slug(bundle.bundleId);
  if (!bundleId) throw publisherError("Candidate bundleId is required", "SOD_PUBLICATION_BUNDLE_ID_REQUIRED");
  const id = slug(publicationId);
  if (!id) throw publisherError("Publication id is required", "SOD_PUBLICATION_ID_REQUIRED");
  const timestamp = safeTimestamp(bundle.generatedAt);

  const finalName = `${timestamp}-${bundleId}-${id}.json`;
  const tempName = `.sod-publish-${id}.tmp`;
  return {
    inbox,
    tempPath: path.join(inbox, tempName),
    finalPath: path.join(inbox, finalName),
    tempName,
    finalName,
  };
}

export async function publishCandidateBundleAtomically({
  inboxPath,
  bundle,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  const publicationId = text(idFactory());
  const paths = buildCandidatePublicationPaths({ inboxPath, bundle, publicationId });
  const stat = await fs.stat(paths.inbox).catch((error) => {
    throw publisherError(
      `Candidate inbox is unavailable: ${error.message}`,
      "SOD_PUBLICATION_INBOX_UNAVAILABLE",
      { causeCode: error.code || null },
    );
  });
  if (!stat.isDirectory()) {
    throw publisherError("Candidate inbox path must be a directory", "SOD_PUBLICATION_INBOX_INVALID");
  }

  const bytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  let handle = null;

  try {
    handle = await fs.open(paths.tempPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;

    // Publication names include a unique id, so a pre-existing final path is a
    // fail-closed collision rather than something the publisher may overwrite.
    const finalExists = await fs.stat(paths.finalPath).then(() => true).catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (finalExists) {
      throw publisherError(
        `Candidate publication destination already exists: ${paths.finalPath}`,
        "SOD_PUBLICATION_DESTINATION_COLLISION",
      );
    }

    // Same-directory rename is the publication boundary: the feeder ignores the
    // hidden .tmp name and only sees the complete .json after this atomic step.
    await fs.rename(paths.tempPath, paths.finalPath);

    return {
      publicationId,
      finalPath: paths.finalPath,
      finalName: paths.finalName,
      sha256,
      byteLength: bytes.length,
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(paths.tempPath).catch(() => {});
    if (error?.code?.startsWith?.("SOD_PUBLICATION_")) throw error;
    throw publisherError(
      `Atomic candidate publication failed: ${error.message}`,
      "SOD_CANDIDATE_PUBLICATION_ERROR",
      { causeCode: error.code || null },
    );
  }
}
