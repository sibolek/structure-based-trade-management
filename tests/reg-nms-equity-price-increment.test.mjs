import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_NMS_INCREMENT_AT_OR_ABOVE_ONE,
  REG_NMS_RULE_612_POLICY_ID,
  RegNmsEquityPriceIncrementResolver,
  VARIABLE_MPI_FIRST_TRADING_DATE,
} from "../schwab-bridge/reg-nms-equity-price-increment.mjs";
import { normalizeSchwabQuote } from "../schwab-bridge/schwab-market-data-provider.mjs";

function listedEquityQuote(overrides = {}) {
  return {
    symbol: "NVDA",
    source: "SCHWAB",
    assetMainType: "EQUITY",
    assetSubType: "COE",
    quoteType: "NBBO",
    realtime: true,
    exchange: "Q",
    exchangeName: "NASDAQ",
    otcMarketTier: null,
    bid: 218.21,
    ask: 218.22,
    last: 218.215,
    mark: 218.215,
    tick: 0,
    ...overrides,
  };
}

test("Schwab normalization preserves NMS listing evidence needed by the regulatory resolver", () => {
  const quote = normalizeSchwabQuote({
    NVDA: {
      assetMainType: "EQUITY",
      assetSubType: "COE",
      quoteType: "NBBO",
      realtime: true,
      quote: {
        bidPrice: 218.21,
        askPrice: 218.22,
        lastPrice: 218.215,
        quoteTime: 1_800_000_000_000,
      },
      reference: {
        exchange: "Q",
        exchangeName: "NASDAQ",
        otcMarketTier: null,
      },
    },
  }, "NVDA", { receivedAtMs: 1_800_000_000_100 });

  assert.equal(quote.quoteType, "NBBO");
  assert.equal(quote.realtime, true);
  assert.equal(quote.exchange, "Q");
  assert.equal(quote.exchangeName, "NASDAQ");
  assert.equal(quote.otcMarketTier, null);
});

test("pre-variable-MPI Rule 612 resolver verifies a penny increment for an exchange-listed NBBO equity above one dollar", async () => {
  const resolver = new RegNmsEquityPriceIncrementResolver({
    now: () => Date.parse("2026-08-31T18:42:44.000Z"),
  });
  const result = await resolver.getInstrumentMetadata("NVDA", { quote: listedEquityQuote() });

  assert.equal(result.verified, true);
  assert.equal(result.provider, REG_NMS_RULE_612_POLICY_ID);
  assert.equal(result.instrumentType, "EQUITY");
  assert.equal(result.priceIncrement, LEGACY_NMS_INCREMENT_AT_OR_ABOVE_ONE);
  assert.equal(result.instrumentValueMetadata.regulatoryRegime, "PRE_VARIABLE_MPI_RULE_612");
  assert.equal(result.instrumentValueMetadata.variableMpiFirstTradingDate, VARIABLE_MPI_FIRST_TRADING_DATE);
  assert.equal(result.instrumentValueMetadata.verificationEvidence.quoteType, "NBBO");
  assert.equal(result.instrumentValueMetadata.verificationEvidence.exchangeName, "NASDAQ");
  assert.equal(Object.isFrozen(result), true);
});

test("resolver fails closed when NMS listing evidence is missing, non-NBBO, or explicitly OTC", async () => {
  const resolver = new RegNmsEquityPriceIncrementResolver({
    now: () => Date.parse("2026-08-31T18:42:44.000Z"),
  });

  for (const quote of [
    listedEquityQuote({ quoteType: null }),
    listedEquityQuote({ quoteType: "NFL" }),
    listedEquityQuote({ exchange: null, exchangeName: null }),
    listedEquityQuote({ otcMarketTier: "OTCQX" }),
  ]) {
    const result = await resolver.getInstrumentMetadata("NVDA", { quote });
    assert.equal(result.verified, false);
    assert.equal(result.priceIncrement, null);
    assert.equal(result.reason, "NMS_LISTING_NOT_VERIFIED");
  }
});

test("resolver does not apply the equity Rule 612 fallback to unsupported or sub-dollar instruments", async () => {
  const resolver = new RegNmsEquityPriceIncrementResolver({
    now: () => Date.parse("2026-08-31T18:42:44.000Z"),
  });

  const future = await resolver.getInstrumentMetadata("/ESU26", {
    quote: listedEquityQuote({ assetMainType: "FUTURE" }),
  });
  assert.equal(future.verified, false);
  assert.equal(future.reason, "UNSUPPORTED_INSTRUMENT_TYPE");

  const subDollar = await resolver.getInstrumentMetadata("TEST", {
    quote: listedEquityQuote({ bid: 0.74, ask: 0.75, last: 0.745, mark: 0.745 }),
  });
  assert.equal(subDollar.verified, false);
  assert.equal(subDollar.reason, "SUB_DOLLAR_EQUITY_NOT_SUPPORTED");
});

test("resolver stops authorizing the legacy penny regime on the first business day of November 2026", async () => {
  const before = new RegNmsEquityPriceIncrementResolver({
    now: () => Date.parse("2026-10-30T19:59:59.000Z"),
  });
  const beforeResult = await before.getInstrumentMetadata("NVDA", { quote: listedEquityQuote() });
  assert.equal(beforeResult.verified, true);
  assert.equal(beforeResult.priceIncrement, 0.01);

  const transition = new RegNmsEquityPriceIncrementResolver({
    now: () => Date.parse("2026-11-02T14:30:00.000Z"),
  });
  const transitionResult = await transition.getInstrumentMetadata("NVDA", { quote: listedEquityQuote() });
  assert.equal(transitionResult.verified, false);
  assert.equal(transitionResult.priceIncrement, null);
  assert.equal(transitionResult.reason, "VARIABLE_MPI_SOURCE_REQUIRED");
  assert.equal(transitionResult.details.variableMpiFirstTradingDate, "2026-11-02");
});

test("resolver clock fails closed instead of coercing invalid time", async () => {
  const resolver = new RegNmsEquityPriceIncrementResolver({ now: () => "not-a-time" });
  await assert.rejects(
    () => resolver.getInstrumentMetadata("NVDA", { quote: listedEquityQuote() }),
    /clock must return epoch milliseconds/,
  );
});
