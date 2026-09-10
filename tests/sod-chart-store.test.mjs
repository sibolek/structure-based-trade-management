import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { invokeSodAnalysisProvider } from "../schwab-bridge/sod-analysis-provider.mjs";
import {
  createSodChartStore,
  MAX_SOD_CHART_BYTES,
} from "../schwab-bridge/sod-chart-store.mjs";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function tempStore(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-chart-store-test-"));
  const store = createSodChartStore({ rootPath: root, ...options });
  return {
    root,
    store,
    async cleanup() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

test("SOD chart store ingests immutable raster bytes and resolves opaque refs without exposing paths", async () => {
  const fixture = await tempStore({
    idFactory: () => "charttest0001",
    clock: () => "2026-09-09T20:00:00.000Z",
  });
  try {
    const descriptor = await fixture.store.ingest({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      displayName: "NVDA 5m.png",
    });

    assert.equal(descriptor.chartId, "chart-charttest0001");
    assert.equal(descriptor.contentRef, "sod-chart:charttest0001");
    assert.equal(descriptor.displayName, "NVDA 5m.png");
    assert.equal(descriptor.byteLength, PNG_BYTES.length);
    assert.equal("path" in descriptor, false);

    const resolved = await fixture.store.resolve(descriptor.contentRef);
    assert.equal(resolved.chartId, descriptor.chartId);
    assert.equal(Buffer.compare(resolved.bytes, PNG_BYTES), 0);
    assert.equal("path" in resolved, false);

    const names = (await fs.readdir(fixture.root)).sort();
    assert.deepEqual(names, ["charttest0001.bin", "charttest0001.json"]);
  } finally {
    await fixture.cleanup();
  }
});

test("SOD chart store rejects unsupported media, signature mismatch, and oversize input", async () => {
  const fixture = await tempStore({ idFactory: () => "charttest0002" });
  try {
    await assert.rejects(
      fixture.store.ingest({ bytes: Buffer.from("<svg></svg>"), mediaType: "image/svg+xml" }),
      (error) => error.code === "SOD_CHART_MEDIA_TYPE_UNSUPPORTED",
    );
    await assert.rejects(
      fixture.store.ingest({ bytes: Buffer.from("not a png"), mediaType: "image/png" }),
      (error) => error.code === "SOD_CHART_MEDIA_SIGNATURE_MISMATCH",
    );

    const smallLimitStore = createSodChartStore({
      rootPath: fixture.root,
      idFactory: () => "charttest0003",
      maxBytes: 1024,
    });
    await assert.rejects(
      smallLimitStore.ingest({
        bytes: Buffer.concat([PNG_BYTES, Buffer.alloc(1024)]),
        mediaType: "image/png",
      }),
      (error) => error.code === "SOD_CHART_TOO_LARGE",
    );
    assert.equal(MAX_SOD_CHART_BYTES > 1024, true);
  } finally {
    await fixture.cleanup();
  }
});

test("SOD chart store detects immutable byte tampering before provider consumption", async () => {
  const fixture = await tempStore({ idFactory: () => "charttest0004" });
  try {
    const descriptor = await fixture.store.ingest({ bytes: PNG_BYTES, mediaType: "image/png" });
    await fs.writeFile(path.join(fixture.root, "charttest0004.bin"), Buffer.from([0x00, 0x01, 0x02]));
    await assert.rejects(
      fixture.store.resolve(descriptor.contentRef),
      (error) => error.code === "SOD_CHART_INTEGRITY_FAILURE",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("SOD analysis provider can resolve only chart refs authorized by its normalized request", async () => {
  const fixture = await tempStore({ idFactory: () => "charttest0005" });
  try {
    const descriptor = await fixture.store.ingest({ bytes: PNG_BYTES, mediaType: "image/png" });
    let authorizedBytes = null;
    const invocation = await invokeSodAnalysisProvider({
      async generate(request, context) {
        const chart = await context.resolveChart(request.charts[0].contentRef);
        authorizedBytes = chart.bytes;
        await assert.rejects(
          context.resolveChart("sod-chart:outside000"),
          (error) => error.code === "SOD_ANALYSIS_CHART_NOT_AUTHORIZED",
        );
        return { candidateProposals: [] };
      },
    }, {
      sourceDate: "2026-09-09",
      charts: [{ chartId: descriptor.chartId, contentRef: descriptor.contentRef }],
    }, {
      resolveChart: fixture.store.resolve,
    });

    assert.equal(invocation.result.candidateProposals.length, 0);
    assert.equal(Buffer.compare(authorizedBytes, PNG_BYTES), 0);
  } finally {
    await fixture.cleanup();
  }
});
