// v3 derived from user-confirmed running baseline, commit 99cd783.
// Separate class/file; existing ExecutionOSPullingStacking remains unchanged.
// Rolling execution attribution is an estimate; see validation report.
//
// Copyright (C) 2026, NinjaTrader LLC <www.ninjatrader.com>.
// NinjaTrader reserves the right to modify or overwrite this NinjaScript component with each release.
//

#region Using declarations
using NinjaTrader.Core.FloatingPoint;
using NinjaTrader.Data;
using NinjaTrader.Gui.SuperDom;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Xml.Serialization;

#endregion

namespace NinjaTrader.NinjaScript.SuperDomColumns
{
    public partial class ExecutionOSPullingStacking_v3 : SuperDomColumn
    {
        private sealed class SpoofAlertState
        {
            public DateTime ExpiresUtc { get; set; }
            public bool IsEscalated { get; set; }
        }

        private sealed class SpoofCandidate
        {
            public long ExecutedVolume { get; set; }
            public long PeakStackVolume { get; set; }
            public DateTime StartedUtc { get; set; }
        }

        private Dictionary<double, Timer> askNoDataResetTimers;
        private Dictionary<double, Timer> bidNoDataResetTimers;
        private Dictionary<double, Tuple<long, long>> askPriceDepthMap;
        private Dictionary<double, Tuple<long, long>> bidPriceDepthMap;
        private Timer bidAskResetTimer;

        private readonly object collectionSync = new object();

        private FontFamily fontFamily;
        private FontStyle fontStyle;
        private FontWeight fontWeight;
        private Pen gridPen;
        private double halfPenWidth;
        private bool heightUpdateNeeded;
        private Dictionary<string, double> mmAskPriceMap;
        private Dictionary<string, double> mmBidPriceMap;
        private double previousAsk = double.MinValue;
        private double previousBid = double.MinValue;
        private Dictionary<double, SpoofAlertState> askSpoofAlerts;
        private Dictionary<double, SpoofAlertState> bidSpoofAlerts;
        private Dictionary<double, SpoofCandidate> askSpoofCandidates;
        private Dictionary<double, SpoofCandidate> bidSpoofCandidates;
        private Queue<DateTime> askSpoofEvents;
        private Queue<DateTime> bidSpoofEvents;
        private DateTime lastSpoofSoundUtc = DateTime.MinValue;
        private Timer spoofAlertRefreshTimer;
        private double textHeight;
        private Typeface typeFace;

        public override void OnColumnLabelClicked(object sender, MouseButtonEventArgs e)
        {
            lock (collectionSync)
            {
                if (v3Terminated) return;
                resetGeneration++;
                DisposeLegacyResetTimers();
                ResetRollingHistory();
                askNoDataResetTimers.Clear();
                bidNoDataResetTimers.Clear();
                askPriceDepthMap.Clear();
                bidPriceDepthMap.Clear();
                mmAskPriceMap.Clear();
                mmBidPriceMap.Clear();
                ClearSpoofDetectionState();

                if (SuperDom == null
                    || SuperDom.MarketDepth == null
                    || SuperDom.MarketDepth.Instrument == null)
                {
                    return;
                }

                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                {
                    for (int i = 0; i < SuperDom.MarketDepth.Asks.Count; i++)
                    {
                        askPriceDepthMap.Add(
                            SuperDom.MarketDepth.Asks[i].Price,
                            Tuple.Create(
                                SuperDom.MarketDepth.Asks[i].Volume,
                                0L));
                    }

                    for (int i = 0; i < SuperDom.MarketDepth.Bids.Count; i++)
                    {
                        bidPriceDepthMap.Add(
                            SuperDom.MarketDepth.Bids[i].Price,
                            Tuple.Create(
                                SuperDom.MarketDepth.Bids[i].Volume,
                                0L));
                    }
                }

                OnPropertyChanged();
            }
        }

        protected override void OnMarketData(MarketDataEventArgs marketData)
        {
            lock (collectionSync)
            {
                if (v3Terminated || State != State.Active) return;
                if ((!marketData.IsReset || marketData.Instrument != null)
                    && !MatchesInstrument(marketData.Instrument)) return;
                long now = EnsureV3Context();
                if (marketData.IsReset)
                {
                    ResetV3FeedState(now);
                    OnPropertyChanged();
                    return;
                }
                if (CalculationMode == ExecutionOSPullingStackingCalculationModeV3.RollingWindow)
                    CheckRollingSession(now);
                ProcessRollingTrade(marketData, now);

                if (marketData.MarketDataType == MarketDataType.Last)
                {
                    lock (collectionSync)
                    {
                        Tuple<long, long> depthTuple;

                        TrackSpoofExecutions(
                            marketData.Price,
                            marketData.Volume);

                        if (askPriceDepthMap.TryGetValue(
                            marketData.Price,
                            out depthTuple))
                        {
                            askPriceDepthMap[marketData.Price] = Tuple.Create(
                                depthTuple.Item1 - marketData.Volume,
                                depthTuple.Item2 - marketData.Volume);
                        }

                        if (bidPriceDepthMap.TryGetValue(
                            marketData.Price,
                            out depthTuple))
                        {
                            bidPriceDepthMap[marketData.Price] = Tuple.Create(
                                depthTuple.Item1 - marketData.Volume,
                                depthTuple.Item2 - marketData.Volume);
                        }
                    }
                }
                else if (ResetWhen == PullingStackingResetWhen.BidAskChange)
                {
                    if (marketData.MarketDataType == MarketDataType.Ask
                        && (previousAsk <= double.MinValue
                            || previousAsk.ApproxCompare(marketData.Price) != 0))
                    {
                        if (previousAsk > double.MinValue)
                        {
                            if (bidAskResetTimer != null)
                                bidAskResetTimer.Dispose();

                            bidAskResetTimer = CreateGuardedTimer(
                                OnBidAskResetTimerCallback,
                                Tuple.Create(
                                    marketData.Price,
                                    marketData.MarketDataType),
                                ResetTolerance,
                                Timeout.Infinite);
                        }

                        previousAsk = marketData.Price;
                    }
                    else if (marketData.MarketDataType == MarketDataType.Bid
                        && (previousBid <= double.MinValue
                            || previousBid.ApproxCompare(marketData.Price) != 0))
                    {
                        if (previousBid > double.MinValue)
                        {
                            if (bidAskResetTimer != null)
                                bidAskResetTimer.Dispose();

                            bidAskResetTimer = CreateGuardedTimer(
                                OnBidAskResetTimerCallback,
                                Tuple.Create(
                                    marketData.Price,
                                    marketData.MarketDataType),
                                ResetTolerance,
                                Timeout.Infinite);
                        }

                        previousBid = marketData.Price;
                    }
                }

            }
        }

        protected override void OnMarketDepth(
            MarketDepthEventArgs marketDepth)
        {
            lock (collectionSync)
            {
                if (v3Terminated || State != State.Active) return;
                if ((!marketDepth.IsReset || marketDepth.Instrument != null)
                    && !MatchesInstrument(marketDepth.Instrument)) return;
                long now = EnsureV3Context();

                if (marketDepth.IsReset)
                {
                    ResetV3FeedState(now);
                    OnPropertyChanged();
                    return;
                }

                if (SuperDom == null
                    || SuperDom.MarketDepth == null
                    || SuperDom.MarketDepth.Instrument == null)
                {
                    return;
                }

                if (CalculationMode == ExecutionOSPullingStackingCalculationModeV3.RollingWindow)
                    CheckRollingSession(now);
                ProcessRollingDepth(marketDepth, now);

                if (marketDepth.Position < 0 || marketDepth.Position >= SuperDom.DepthLevels)
                    return;

                lock (collectionSync)
                {
                    if (marketDepth.MarketDataType == MarketDataType.Ask)
                    {
                        ProcessAskDepth(marketDepth);
                        TrackSpoofCandidate(marketDepth, true);
                    }
                    else if (marketDepth.MarketDataType == MarketDataType.Bid)
                    {
                        ProcessBidDepth(marketDepth);
                        TrackSpoofCandidate(marketDepth, false);
                    }
                }

            }
        }

        private void ProcessAskDepth(
            MarketDepthEventArgs marketDepth)
        {
            if (marketDepth.Operation == Cbi.Operation.Add)
            {
                if (marketDepth.Price.ApproxCompare(0) == 0
                    && marketDepth.Volume == 0)
                {
                    return;
                }

                PriceRow row;
                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                {
                    row = SuperDom.Rows.FirstOrDefault(
                        r => r.Price.ApproxCompare(
                            marketDepth.Price) == 0);
                }

                if (!string.IsNullOrEmpty(
                    marketDepth.MarketMaker))
                {
                    mmAskPriceMap[marketDepth.MarketMaker]
                        = marketDepth.Price;
                }

                Tuple<long, long> existingDepth;
                if (askPriceDepthMap.TryGetValue(
                        marketDepth.Price,
                        out existingDepth)
                    && existingDepth.Item1 > 0)
                {
                    askPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            existingDepth.Item1,
                            marketDepth.Volume
                                - existingDepth.Item1);
                }
                else
                {
                    long baselineVolume = row != null
                        ? row.AskVolume
                        : marketDepth.Volume;

                    askPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            baselineVolume,
                            0L);
                }

                return;
            }

            if (marketDepth.Operation
                == Cbi.Operation.Update)
            {
                Tuple<long, long> depthTuple;

                if (askPriceDepthMap.TryGetValue(
                    marketDepth.Price,
                    out depthTuple))
                {
                    askPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            depthTuple.Item1,
                            marketDepth.Volume
                                - depthTuple.Item1);
                }
                else
                {
                    askPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            marketDepth.Volume,
                            0L);
                }

                return;
            }

            if (ResetWhen
                != PullingStackingResetWhen.NoMoreData)
            {
                return;
            }

            double price = marketDepth.Price;

            if (!string.IsNullOrEmpty(
                marketDepth.MarketMaker))
            {
                double mmPrice;

                if (mmAskPriceMap.TryGetValue(
                    marketDepth.MarketMaker,
                    out mmPrice))
                {
                    price = mmPrice;
                }
            }

            PriceRow noDataRow;
            lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
            {
                noDataRow = SuperDom.Rows.FirstOrDefault(
                    r => r.Price.ApproxCompare(price) == 0);
            }

            if (noDataRow == null
                || noDataRow.AskVolume > 0)
            {
                return;
            }

            Timer existingTimer;

            if (askNoDataResetTimers.TryGetValue(
                price,
                out existingTimer))
            {
                existingTimer.Dispose();
            }

            askNoDataResetTimers[price] = CreateGuardedTimer(
                OnNoDataResetTimerCallback,
                Tuple.Create(
                    price,
                    MarketDataType.Ask),
                ResetTolerance,
                Timeout.Infinite);
        }

        private void ProcessBidDepth(
            MarketDepthEventArgs marketDepth)
        {
            if (marketDepth.Operation == Cbi.Operation.Add)
            {
                if (marketDepth.Price.ApproxCompare(0) == 0
                    && marketDepth.Volume == 0)
                {
                    return;
                }

                PriceRow row;
                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                {
                    row = SuperDom.Rows.FirstOrDefault(
                        r => r.Price.ApproxCompare(
                            marketDepth.Price) == 0);
                }

                if (!string.IsNullOrEmpty(
                    marketDepth.MarketMaker))
                {
                    mmBidPriceMap[marketDepth.MarketMaker]
                        = marketDepth.Price;
                }

                Tuple<long, long> existingDepth;

                if (bidPriceDepthMap.TryGetValue(
                        marketDepth.Price,
                        out existingDepth)
                    && existingDepth.Item1 > 0)
                {
                    bidPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            existingDepth.Item1,
                            marketDepth.Volume
                                - existingDepth.Item1);
                }
                else
                {
                    long baselineVolume = row != null
                        ? row.BidVolume
                        : marketDepth.Volume;

                    bidPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            baselineVolume,
                            0L);
                }

                return;
            }

            if (marketDepth.Operation
                == Cbi.Operation.Update)
            {
                Tuple<long, long> depthTuple;

                if (bidPriceDepthMap.TryGetValue(
                    marketDepth.Price,
                    out depthTuple))
                {
                    bidPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            depthTuple.Item1,
                            marketDepth.Volume
                                - depthTuple.Item1);
                }
                else
                {
                    bidPriceDepthMap[marketDepth.Price]
                        = Tuple.Create(
                            marketDepth.Volume,
                            0L);
                }

                return;
            }

            if (ResetWhen
                != PullingStackingResetWhen.NoMoreData)
            {
                return;
            }

            double price = marketDepth.Price;

            if (!string.IsNullOrEmpty(
                marketDepth.MarketMaker))
            {
                double mmPrice;

                if (mmBidPriceMap.TryGetValue(
                    marketDepth.MarketMaker,
                    out mmPrice))
                {
                    price = mmPrice;
                }
            }

            PriceRow noDataRow;
            lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
            {
                noDataRow = SuperDom.Rows.FirstOrDefault(
                    r => r.Price.ApproxCompare(price) == 0);
            }

            if (noDataRow == null
                || noDataRow.BidVolume > 0)
            {
                return;
            }

            Timer existingTimer;

            if (bidNoDataResetTimers.TryGetValue(
                price,
                out existingTimer))
            {
                existingTimer.Dispose();
            }

            bidNoDataResetTimers[price] = CreateGuardedTimer(
                OnNoDataResetTimerCallback,
                Tuple.Create(
                    price,
                    MarketDataType.Bid),
                ResetTolerance,
                Timeout.Infinite);
        }

        private void TrackSpoofExecutions(
            double price,
            long volume)
        {
            if (!SpoofDetectionEnabled || volume <= 0)
                return;

            SpoofCandidate candidate;

            if (askSpoofCandidates.TryGetValue(
                price,
                out candidate))
            {
                candidate.ExecutedVolume += volume;
            }

            if (bidSpoofCandidates.TryGetValue(
                price,
                out candidate))
            {
                candidate.ExecutedVolume += volume;
            }
        }

        private void TrackSpoofCandidate(
            MarketDepthEventArgs marketDepth,
            bool isAsk)
        {
            if (!SpoofDetectionEnabled)
                return;

            Dictionary<double, Tuple<long, long>> depthMap
                = isAsk
                    ? askPriceDepthMap
                    : bidPriceDepthMap;

            Dictionary<double, SpoofCandidate> candidates
                = isAsk
                    ? askSpoofCandidates
                    : bidSpoofCandidates;

            DateTime now = DateTime.UtcNow;
            SpoofCandidate candidate;

            if (marketDepth.Operation
                == Cbi.Operation.Remove)
            {
                if (candidates.TryGetValue(
                        marketDepth.Price,
                        out candidate)
                    && (now - candidate.StartedUtc)
                        .TotalMilliseconds
                        <= SpoofMaximumLifetimeMilliseconds
                    && candidate.ExecutedVolume
                        <= (long)Math.Floor(
                            candidate.PeakStackVolume
                            * SpoofMaximumExecutedPercent
                            / 100.0))
                {
                    TriggerSpoofAlert(
                        marketDepth.Price,
                        isAsk,
                        now);
                }

                candidates.Remove(marketDepth.Price);
                return;
            }

            if (marketDepth.Operation
                    != Cbi.Operation.Add
                && marketDepth.Operation
                    != Cbi.Operation.Update)
            {
                return;
            }

            Tuple<long, long> depth;

            if (!depthMap.TryGetValue(
                marketDepth.Price,
                out depth))
            {
                return;
            }

            if (candidates.TryGetValue(
                marketDepth.Price,
                out candidate))
            {
                double ageMilliseconds
                    = (now - candidate.StartedUtc)
                        .TotalMilliseconds;

                if (ageMilliseconds
                    > SpoofMaximumLifetimeMilliseconds)
                {
                    candidates.Remove(marketDepth.Price);
                    candidate = null;
                }
                else
                {
                    if (depth.Item2
                        > candidate.PeakStackVolume)
                    {
                        candidate.PeakStackVolume
                            = depth.Item2;
                    }

                    long requiredPull
                        = (long)Math.Ceiling(
                            candidate.PeakStackVolume
                            * SpoofPullPercent
                            / 100.0);

                    long pulledVolume
                        = candidate.PeakStackVolume
                            - depth.Item2;

                    long maximumExecuted
                        = (long)Math.Floor(
                            candidate.PeakStackVolume
                            * SpoofMaximumExecutedPercent
                            / 100.0);

                    if (pulledVolume >= requiredPull
                        && candidate.ExecutedVolume
                            <= maximumExecuted)
                    {
                        TriggerSpoofAlert(
                            marketDepth.Price,
                            isAsk,
                            now);

                        candidates.Remove(
                            marketDepth.Price);

                        return;
                    }
                }
            }

            if (candidate == null
                && marketDepth.Position >= 0
                && marketDepth.Position
                    < SpoofMaximumDepthLevels
                && depth.Item2
                    >= SpoofMinimumStackVolume)
            {
                candidates[marketDepth.Price]
                    = new SpoofCandidate
                    {
                        PeakStackVolume = depth.Item2,
                        StartedUtc = now
                    };
            }
        }

        private void TriggerSpoofAlert(
            double price,
            bool isAsk,
            DateTime now)
        {
            Queue<DateTime> events
                = isAsk
                    ? askSpoofEvents
                    : bidSpoofEvents;

            while (events.Count > 0
                && (now - events.Peek())
                    .TotalMilliseconds
                    > SpoofRepeatWindowMilliseconds)
            {
                events.Dequeue();
            }

            events.Enqueue(now);

            Dictionary<double, SpoofAlertState> alerts
                = isAsk
                    ? askSpoofAlerts
                    : bidSpoofAlerts;

            alerts[price] = new SpoofAlertState
            {
                ExpiresUtc = now.AddMilliseconds(
                    SpoofAlertDisplayMilliseconds),

                IsEscalated = events.Count >= 2
            };

            PlaySpoofAlertSound(now);
            ScheduleSpoofAlertRefresh(now);
            OnPropertyChanged();
        }

        private void PlaySpoofAlertSound(DateTime now)
        {
            if (!SpoofAudibleAlertEnabled
                || string.IsNullOrEmpty(SpoofAlertSound)
                || !System.IO.File.Exists(
                    SpoofAlertSound)
                || (now - lastSpoofSoundUtc)
                    .TotalMilliseconds
                    < SpoofSoundCooldownMilliseconds)
            {
                return;
            }

            lastSpoofSoundUtc = now;
            Core.Globals.PlaySound(SpoofAlertSound);
        }

        private void ScheduleSpoofAlertRefresh(
            DateTime now)
        {
            DateTime nextExpiration = DateTime.MaxValue;

            foreach (SpoofAlertState alert
                in askSpoofAlerts.Values)
            {
                if (alert.ExpiresUtc < nextExpiration)
                    nextExpiration = alert.ExpiresUtc;
            }

            foreach (SpoofAlertState alert
                in bidSpoofAlerts.Values)
            {
                if (alert.ExpiresUtc < nextExpiration)
                    nextExpiration = alert.ExpiresUtc;
            }

            if (spoofAlertRefreshTimer != null)
            {
                spoofAlertRefreshTimer.Dispose();
                spoofAlertRefreshTimer = null;
            }

            if (nextExpiration == DateTime.MaxValue)
                return;

            int dueTime = Math.Max(
                1,
                (int)Math.Ceiling(
                    (nextExpiration - now)
                    .TotalMilliseconds));

            spoofAlertRefreshTimer = CreateGuardedTimer(
                OnSpoofAlertRefreshTimerCallback,
                null,
                dueTime,
                Timeout.Infinite);
        }

        private void OnSpoofAlertRefreshTimerCallback(
            object state)
        {
            lock (collectionSync)
            {
                DateTime now = DateTime.UtcNow;

                RemoveExpiredSpoofAlerts(
                    askSpoofAlerts,
                    now);

                RemoveExpiredSpoofAlerts(
                    bidSpoofAlerts,
                    now);

                ScheduleSpoofAlertRefresh(now);
            }

            OnPropertyChanged();
        }

        private void RemoveExpiredSpoofAlerts(
            Dictionary<double, SpoofAlertState> alerts,
            DateTime now)
        {
            List<double> expiredPrices = alerts
                .Where(pair =>
                    pair.Value.ExpiresUtc <= now)
                .Select(pair => pair.Key)
                .ToList();

            foreach (double price in expiredPrices)
                alerts.Remove(price);
        }

        private void ClearSpoofDetectionState()
        {
            askSpoofAlerts.Clear();
            bidSpoofAlerts.Clear();
            askSpoofCandidates.Clear();
            bidSpoofCandidates.Clear();
            askSpoofEvents.Clear();
            bidSpoofEvents.Clear();
            lastSpoofSoundUtc = DateTime.MinValue;

            if (spoofAlertRefreshTimer != null)
            {
                spoofAlertRefreshTimer.Dispose();
                spoofAlertRefreshTimer = null;
            }
        }

        protected override void OnRender(
            DrawingContext dc,
            double renderWidth)
        {
            if (SuperDom == null || v3Terminated) return;
            lock (collectionSync)
            {
                if (State == State.Active)
                {
                    long now = EnsureV3Context();
                    if (CalculationMode == ExecutionOSPullingStackingCalculationModeV3.RollingWindow)
                        CheckRollingSession(now);
                }
            }

            if (gridPen == null && UiWrapper != null)
            {
                PresentationSource source
                    = PresentationSource.FromVisual(
                        UiWrapper);

                if (source != null
                    && source.CompositionTarget != null)
                {
                    Matrix matrix
                        = source.CompositionTarget
                            .TransformToDevice;

                    double dpiFactor
                        = 1.0 / matrix.M11;

                    gridPen = new Pen(
                        Application.Current.TryFindResource(
                            "BorderThinBrush") as Brush,
                        1.0 * dpiFactor);

                    halfPenWidth
                        = gridPen.Thickness * 0.5;
                }
            }

            if (!Equals(
                    fontFamily,
                    SuperDom.Font.Family)
                || (SuperDom.Font.Italic
                    && fontStyle != FontStyles.Italic)
                || (!SuperDom.Font.Italic
                    && fontStyle == FontStyles.Italic)
                || (SuperDom.Font.Bold
                    && fontWeight != FontWeights.Bold)
                || (!SuperDom.Font.Bold
                    && fontWeight == FontWeights.Bold))
            {
                fontFamily = SuperDom.Font.Family;

                fontStyle = SuperDom.Font.Italic
                    ? FontStyles.Italic
                    : FontStyles.Normal;

                fontWeight = SuperDom.Font.Bold
                    ? FontWeights.Bold
                    : FontWeights.Normal;

                typeFace = new Typeface(
                    fontFamily,
                    fontStyle,
                    fontWeight,
                    FontStretches.Normal);

                heightUpdateNeeded = true;
            }

            double verticalOffset = gridPen == null
                ? 0.0
                : -gridPen.Thickness;

            double pixelsPerDip = UiWrapper == null
                ? 1.0
                : VisualTreeHelper
                    .GetDpi(UiWrapper)
                    .PixelsPerDip;

            lock (SuperDom.Rows)
            {
                foreach (PriceRow row in SuperDom.Rows)
                {
                    if (renderWidth - halfPenWidth < 0)
                        continue;

                    Rect rect = new Rect(
                        -halfPenWidth,
                        verticalOffset,
                        renderWidth - halfPenWidth,
                        SuperDom.ActualRowHeight);

                    GuidelineSet guidelines
                        = new GuidelineSet();

                    guidelines.GuidelinesX.Add(
                        rect.Left + halfPenWidth);

                    guidelines.GuidelinesX.Add(
                        rect.Right + halfPenWidth);

                    guidelines.GuidelinesY.Add(
                        rect.Top + halfPenWidth);

                    guidelines.GuidelinesY.Add(
                        rect.Bottom + halfPenWidth);

                    dc.PushGuidelineSet(guidelines);

                    if (DisplayType
                        == PullingStackingDisplayType.BidAsk)
                    {
                        Rect bidRect = new Rect(
                            -halfPenWidth,
                            verticalOffset,
                            renderWidth / 2.0
                                - halfPenWidth,
                            SuperDom.ActualRowHeight);

                        Rect askRect = new Rect(
                            renderWidth / 2.0
                                - halfPenWidth,
                            verticalOffset,
                            renderWidth / 2.0
                                - halfPenWidth,
                            SuperDom.ActualRowHeight);

                        dc.DrawRectangle(
                            BidBackColor,
                            null,
                            bidRect);

                        dc.DrawRectangle(
                            AskBackColor,
                            null,
                            askRect);
                    }
                    else if (DisplayType
                        == PullingStackingDisplayType.Ask)
                    {
                        dc.DrawRectangle(
                            AskBackColor,
                            null,
                            rect);
                    }
                    else if (DisplayType
                        == PullingStackingDisplayType.Bid)
                    {
                        dc.DrawRectangle(
                            BidBackColor,
                            null,
                            rect);
                    }

                    if (gridPen != null)
                    {
                        dc.DrawLine(
                            gridPen,
                            new Point(
                                -gridPen.Thickness,
                                rect.Bottom),
                            new Point(
                                renderWidth
                                    - halfPenWidth,
                                rect.Bottom));

                        dc.DrawLine(
                            gridPen,
                            new Point(
                                rect.Right,
                                verticalOffset),
                            new Point(
                                rect.Right,
                                rect.Bottom));
                    }

                    if (SuperDom.IsConnected
                        && !SuperDom.IsReloading
                        && State == State.Active)
                    {
                        lock (collectionSync)
                        {
                            DrawBidValue(
                                dc,
                                row,
                                renderWidth,
                                verticalOffset,
                                pixelsPerDip);

                            DrawAskValue(
                                dc,
                                row,
                                renderWidth,
                                verticalOffset,
                                pixelsPerDip);

                            DrawSpoofAlert(
                                dc,
                                row,
                                renderWidth,
                                verticalOffset,
                                pixelsPerDip,
                                false);

                            DrawSpoofAlert(
                                dc,
                                row,
                                renderWidth,
                                verticalOffset,
                                pixelsPerDip,
                                true);
                        }
                    }

                    dc.Pop();

                    verticalOffset
                        += SuperDom.ActualRowHeight;
                }
            }
        }

        private void DrawBidValue(
            DrawingContext dc,
            PriceRow row,
            double renderWidth,
            double verticalOffset,
            double pixelsPerDip)
        {
            if (DisplayType
                    != PullingStackingDisplayType.BidAsk
                && DisplayType
                    != PullingStackingDisplayType.Bid)
            {
                return;
            }

            bool isRolling = CalculationMode == ExecutionOSPullingStackingCalculationModeV3.RollingWindow;
            Tuple<long, long> bidVolume = null;

            if ((!isRolling && !bidPriceDepthMap.TryGetValue(
                    row.Price,
                    out bidVolume))
                || row.BidVolume <= 0
                || renderWidth / 2.0 - 6.0 <= 0)
            {
                return;
            }

            Typeface currentTypeface = new Typeface(
                SuperDom.Font.Family,
                SuperDom.Font.Italic
                    ? FontStyles.Italic
                    : FontStyles.Normal,
                SuperDom.Font.Bold
                    ? FontWeights.Bold
                    : FontWeights.Normal,
                FontStretches.Normal);

            long bidValue = isRolling ? 0 : bidVolume.Item2;
            bool valueAvailable = !isRolling || TryRollingValue(row.Price, false, out bidValue);

            Brush bidValueBrush = bidValue > 0
                ? Brushes.LimeGreen
                : bidValue < 0
                    ? Brushes.Red
                    : BidForeColor;

            FormattedText bidText = new FormattedText(
                valueAvailable ? bidValue.ToString(
                    Core.Globals.GeneralOptions
                        .CurrentCulture) : "—",
                Core.Globals.GeneralOptions
                    .CurrentCulture,
                FlowDirection.LeftToRight,
                currentTypeface,
                SuperDom.Font.Size,
                bidValueBrush,
                pixelsPerDip);

            bidText.MaxLineCount = 1;

            bidText.MaxTextWidth
                = renderWidth / 2.0 - 6.0;

            bidText.TextAlignment
                = TextAlignment.Center;

            bidText.Trimming
                = TextTrimming.CharacterEllipsis;

            if (heightUpdateNeeded)
            {
                textHeight = bidText.Height;
                heightUpdateNeeded = false;
            }

            dc.DrawText(
                bidText,
                new Point(
                    3.0,
                    verticalOffset
                        + (SuperDom.ActualRowHeight
                            - textHeight)
                        / 2.0));
        }

        private void DrawAskValue(
            DrawingContext dc,
            PriceRow row,
            double renderWidth,
            double verticalOffset,
            double pixelsPerDip)
        {
            if (DisplayType
                    != PullingStackingDisplayType.BidAsk
                && DisplayType
                    != PullingStackingDisplayType.Ask)
            {
                return;
            }

            bool isRolling = CalculationMode == ExecutionOSPullingStackingCalculationModeV3.RollingWindow;
            Tuple<long, long> askVolume = null;

            if ((!isRolling && !askPriceDepthMap.TryGetValue(
                    row.Price,
                    out askVolume))
                || row.AskVolume <= 0
                || renderWidth / 2.0 - 6.0 <= 0)
            {
                return;
            }

            Typeface currentTypeface = new Typeface(
                SuperDom.Font.Family,
                SuperDom.Font.Italic
                    ? FontStyles.Italic
                    : FontStyles.Normal,
                SuperDom.Font.Bold
                    ? FontWeights.Bold
                    : FontWeights.Normal,
                FontStretches.Normal);

            long askValue = isRolling ? 0 : askVolume.Item2;
            bool valueAvailable = !isRolling || TryRollingValue(row.Price, true, out askValue);

            Brush askValueBrush = askValue > 0
                ? Brushes.Red
                : askValue < 0
                    ? Brushes.LimeGreen
                    : AskForeColor;

            FormattedText askText = new FormattedText(
                valueAvailable ? askValue.ToString(
                    Core.Globals.GeneralOptions
                        .CurrentCulture) : "—",
                Core.Globals.GeneralOptions
                    .CurrentCulture,
                FlowDirection.LeftToRight,
                currentTypeface,
                SuperDom.Font.Size,
                askValueBrush,
                pixelsPerDip);

            askText.MaxLineCount = 1;

            askText.MaxTextWidth
                = renderWidth / 2.0 - 6.0;

            askText.TextAlignment
                = TextAlignment.Center;

            askText.Trimming
                = TextTrimming.CharacterEllipsis;

            if (heightUpdateNeeded)
            {
                textHeight = askText.Height;
                heightUpdateNeeded = false;
            }

            dc.DrawText(
                askText,
                new Point(
                    renderWidth / 2.0 + 3.0,
                    verticalOffset
                        + (SuperDom.ActualRowHeight
                            - textHeight)
                        / 2.0));
        }

        private void DrawSpoofAlert(
            DrawingContext dc,
            PriceRow row,
            double renderWidth,
            double verticalOffset,
            double pixelsPerDip,
            bool isAsk)
        {
            if (!SpoofDetectionEnabled
                || renderWidth / 2.0 - 4.0 <= 0)
            {
                return;
            }

            Dictionary<double, SpoofAlertState> alerts
                = isAsk
                    ? askSpoofAlerts
                    : bidSpoofAlerts;

            SpoofAlertState alert;

            if (!alerts.TryGetValue(
                    row.Price,
                    out alert)
                || alert.ExpiresUtc <= DateTime.UtcNow)
            {
                return;
            }

            Brush alertBrush = alert.IsEscalated
                ? Brushes.DarkOrange
                : Brushes.Goldenrod;

            double halfWidth = renderWidth / 2.0;

            Rect alertRect = new Rect(
                (isAsk ? halfWidth : 0.0) + 1.0,
                verticalOffset + 1.0,
                halfWidth - 2.0,
                Math.Max(
                    0.0,
                    SuperDom.ActualRowHeight - 2.0));

            dc.DrawRectangle(
                null,
                new Pen(
                    alertBrush,
                    alert.IsEscalated ? 2.0 : 1.0),
                alertRect);

            FormattedText alertText = new FormattedText(
                alert.IsEscalated ? "S!" : "S?",
                Core.Globals.GeneralOptions
                    .CurrentCulture,
                FlowDirection.LeftToRight,
                typeFace,
                Math.Max(
                    8.0,
                    SuperDom.Font.Size * 0.7),
                alertBrush,
                pixelsPerDip);

            double textX = isAsk
                ? renderWidth
                    - alertText.Width
                    - 3.0
                : 3.0;

            dc.DrawText(
                alertText,
                new Point(
                    textX,
                    verticalOffset
                        + (SuperDom.ActualRowHeight
                            - alertText.Height)
                        / 2.0));
        }

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "ExecutionOS Pulling/Stacking v3";

                Description = Gui.Resource
                    .NinjaScriptSuperdomColumnPullingStackingDescription;

                DefaultWidth = 100;
                PreviousWidth = -1;
                IsDataSeriesRequired = false;

                AskBackColor
                    = Application.Current.TryFindResource(
                        "brushPriceColumnBackground")
                        as Brush;

                AskForeColor
                    = Application.Current.TryFindResource(
                        "brushVolumeColumnForeground")
                        as SolidColorBrush;

                BidBackColor
                    = Application.Current.TryFindResource(
                        "brushPriceColumnBackground")
                        as Brush;

                BidForeColor
                    = Application.Current.TryFindResource(
                        "brushVolumeColumnForeground")
                        as SolidColorBrush;

                askNoDataResetTimers
                    = new Dictionary<double, Timer>();

                bidNoDataResetTimers
                    = new Dictionary<double, Timer>();

                askPriceDepthMap
                    = new Dictionary<
                        double,
                        Tuple<long, long>>();

                bidPriceDepthMap
                    = new Dictionary<
                        double,
                        Tuple<long, long>>();

                mmAskPriceMap
                    = new Dictionary<string, double>();

                mmBidPriceMap
                    = new Dictionary<string, double>();

                askSpoofAlerts
                    = new Dictionary<
                        double,
                        SpoofAlertState>();

                bidSpoofAlerts
                    = new Dictionary<
                        double,
                        SpoofAlertState>();

                askSpoofCandidates
                    = new Dictionary<
                        double,
                        SpoofCandidate>();

                bidSpoofCandidates
                    = new Dictionary<
                        double,
                        SpoofCandidate>();

                askSpoofEvents
                    = new Queue<DateTime>();

                bidSpoofEvents
                    = new Queue<DateTime>();

                DisplayType
                    = PullingStackingDisplayType.BidAsk;

                ResetWhen
                    = PullingStackingResetWhen.BidAskChange;

                ResetTolerance = 2500;
                CalculationMode = ExecutionOSPullingStackingCalculationModeV3.LegacyBaseline;
                RollingWindowSeconds = 5;
                ApplyLegacyResetsToRolling = true;
                ExecutionReconciliationMilliseconds = 250;
                LogRollingDiagnostics = false;

                SpoofDetectionEnabled = true;
                SpoofMinimumStackVolume = 100;
                SpoofMaximumDepthLevels = 3;
                SpoofPullPercent = 80;

                SpoofMaximumLifetimeMilliseconds
                    = 1500;

                SpoofMaximumExecutedPercent = 10;

                SpoofRepeatWindowMilliseconds
                    = 10000;

                SpoofAlertDisplayMilliseconds
                    = 3000;

                SpoofAudibleAlertEnabled = true;

                SpoofAlertSound
                    = System.IO.Path.Combine(
                        Core.Globals.InstallDir,
                        "sounds",
                        "Alert2.wav");

                SpoofSoundCooldownMilliseconds
                    = 3000;
            }
            else if (State == State.Configure)
            {
                if (UiWrapper != null)
                {
                    PresentationSource source
                        = PresentationSource.FromVisual(
                            UiWrapper);

                    if (source != null
                        && source.CompositionTarget != null)
                    {
                        Matrix matrix
                            = source.CompositionTarget
                                .TransformToDevice;

                        double dpiFactor
                            = 1.0 / matrix.M11;

                        gridPen = new Pen(
                            Application.Current
                                .TryFindResource(
                                    "BorderThinBrush")
                                as Brush,
                            1.0 * dpiFactor);

                        halfPenWidth
                            = gridPen.Thickness * 0.5;
                    }
                }
            }
            else if (State == State.Active)
            {
                StartV3();
            }
            else if (State == State.Terminated)
            {
                StopV3();
                if (bidAskResetTimer != null)
                {
                    bidAskResetTimer.Dispose();
                    bidAskResetTimer = null;
                }

                if (spoofAlertRefreshTimer != null)
                {
                    spoofAlertRefreshTimer.Dispose();
                    spoofAlertRefreshTimer = null;
                }
            }
        }

        private void OnBidAskResetTimerCallback(
            object state)
        {
            lock (collectionSync)
            {
                if (SuperDom == null
                    || SuperDom.Instrument == null
                    || SuperDom.Instrument.MarketData
                        == null
                    || SuperDom.Instrument.MarketData.Ask
                        == null
                    || SuperDom.Instrument.MarketData.Bid
                        == null)
                {
                    if (ApplyLegacyResetsToRolling) ResetRollingHistory("Legacy quote reset");
                    askPriceDepthMap.Clear();
                    bidPriceDepthMap.Clear();
                    mmAskPriceMap.Clear();
                    mmBidPriceMap.Clear();
                    askSpoofCandidates.Clear();
                    bidSpoofCandidates.Clear();
                    return;
                }

                Tuple<double, MarketDataType> priorPrice
                    = (Tuple<double, MarketDataType>)state;

                if (priorPrice.Item2
                    == MarketDataType.Ask)
                {
                    if (priorPrice.Item1.ApproxCompare(
                        SuperDom.Instrument.MarketData
                            .Ask.Price) == 0)
                    {
                        return;
                    }
                }
                else if (priorPrice.Item2
                    == MarketDataType.Bid)
                {
                    if (priorPrice.Item1.ApproxCompare(
                        SuperDom.Instrument.MarketData
                            .Bid.Price) == 0)
                    {
                        return;
                    }
                }

                if (ApplyLegacyResetsToRolling) ResetRollingHistory("Legacy quote reset");
                askPriceDepthMap.Clear();
                bidPriceDepthMap.Clear();
                mmAskPriceMap.Clear();
                mmBidPriceMap.Clear();
                askSpoofCandidates.Clear();
                bidSpoofCandidates.Clear();

                if (SuperDom.MarketDepth == null)
                    return;

                lock (SuperDom.MarketDepth.Instrument
                    .SyncMarketDepth)
                {
                    for (int i = 0;
                        i < SuperDom.MarketDepth.Asks.Count;
                        i++)
                    {
                        askPriceDepthMap[
                            SuperDom.MarketDepth.Asks[i].Price]
                            = Tuple.Create(
                                SuperDom.MarketDepth.Asks[i]
                                    .Volume,
                                0L);
                    }

                    for (int i = 0;
                        i < SuperDom.MarketDepth.Bids.Count;
                        i++)
                    {
                        bidPriceDepthMap[
                            SuperDom.MarketDepth.Bids[i].Price]
                            = Tuple.Create(
                                SuperDom.MarketDepth.Bids[i]
                                    .Volume,
                                0L);
                    }
                }
            }
        }

        private void OnNoDataResetTimerCallback(
            object state)
        {
            if (SuperDom == null
                || SuperDom.MarketDepth == null
                || SuperDom.MarketDepth.Instrument == null)
            {
                return;
            }

            lock (collectionSync)
            {
                Tuple<double, MarketDataType> priorPrice
                    = (Tuple<double, MarketDataType>)state;

                lock (SuperDom.MarketDepth.Instrument
                    .SyncMarketDepth)
                {
                    if (priorPrice.Item2
                        == MarketDataType.Ask)
                    {
                        MarketDepthRow row
                            = SuperDom.MarketDepth.Asks
                                .FirstOrDefault(
                                    a => a.Price.ApproxCompare(
                                        priorPrice.Item1) == 0);

                        if (row == null || row.Volume == 0)
                        {
                            askPriceDepthMap[
                                priorPrice.Item1]
                                = Tuple.Create(0L, 0L);

                            ResetRollingLevel(priorPrice.Item1, true);
                            askSpoofCandidates.Remove(
                                priorPrice.Item1);
                        }
                    }
                    else if (priorPrice.Item2
                        == MarketDataType.Bid)
                    {
                        MarketDepthRow row
                            = SuperDom.MarketDepth.Bids
                                .FirstOrDefault(
                                    a => a.Price.ApproxCompare(
                                        priorPrice.Item1) == 0);

                        if (row == null || row.Volume == 0)
                        {
                            bidPriceDepthMap[
                                priorPrice.Item1]
                                = Tuple.Create(0L, 0L);

                            ResetRollingLevel(priorPrice.Item1, false);
                            bidSpoofCandidates.Remove(
                                priorPrice.Item1);
                        }
                    }
                }
            }
        }

        #region Properties

        #region Setup

        [Display(
            ResourceType = typeof(Custom.Resource),
            Name = "NinjaScriptRecentColumnDiplay",
            GroupName = "NinjaScriptSetup",
            Order = 100)]
        public PullingStackingDisplayType DisplayType
        {
            get;
            set;
        }

        [Display(
            ResourceType = typeof(Custom.Resource),
            Name = "NinjaScriptRecentColumnResetWhen",
            GroupName = "NinjaScriptSetup",
            Order = 110)]
        public PullingStackingResetWhen ResetWhen
        {
            get;
            set;
        }

        [Display(
            ResourceType = typeof(Custom.Resource),
            Name = "NinjaScriptRecentColumnResetTolerance",
            GroupName = "NinjaScriptSetup",
            Order = 115)]
        [Range(1, int.MaxValue)]
        public int ResetTolerance
        {
            get;
            set;
        }

        #endregion

        #region Spoof-like alerts

        [Display(
            Name = "Enabled",
            GroupName = "Spoof-like alerts",
            Order = 200)]
        public bool SpoofDetectionEnabled
        {
            get;
            set;
        }

        [Range(1, int.MaxValue)]
        [Display(
            Name = "Minimum stack volume",
            GroupName = "Spoof-like alerts",
            Order = 210)]
        public int SpoofMinimumStackVolume
        {
            get;
            set;
        }

        [Range(1, 20)]
        [Display(
            Name = "Maximum depth levels",
            GroupName = "Spoof-like alerts",
            Order = 220)]
        public int SpoofMaximumDepthLevels
        {
            get;
            set;
        }

        [Range(1, 100)]
        [Display(
            Name = "Minimum pull percent",
            GroupName = "Spoof-like alerts",
            Order = 230)]
        public int SpoofPullPercent
        {
            get;
            set;
        }

        [Range(1, int.MaxValue)]
        [Display(
            Name = "Maximum lifetime (ms)",
            GroupName = "Spoof-like alerts",
            Order = 240)]
        public int SpoofMaximumLifetimeMilliseconds
        {
            get;
            set;
        }

        [Range(0, 100)]
        [Display(
            Name = "Maximum executed percent",
            GroupName = "Spoof-like alerts",
            Order = 250)]
        public int SpoofMaximumExecutedPercent
        {
            get;
            set;
        }

        [Range(1, int.MaxValue)]
        [Display(
            Name = "Repeat window (ms)",
            GroupName = "Spoof-like alerts",
            Order = 260)]
        public int SpoofRepeatWindowMilliseconds
        {
            get;
            set;
        }

        [Range(1, int.MaxValue)]
        [Display(
            Name = "Alert display (ms)",
            GroupName = "Spoof-like alerts",
            Order = 270)]
        public int SpoofAlertDisplayMilliseconds
        {
            get;
            set;
        }

        [Display(
            Name = "Audible alert",
            GroupName = "Spoof-like alerts",
            Order = 280)]
        public bool SpoofAudibleAlertEnabled
        {
            get;
            set;
        }

        [Gui.PropertyEditor(
            "NinjaTrader.Gui.Tools.FilePathPicker",
            Filter = "WAV Files (*.wav)|*.wav")]
        [Display(
            Name = "Alert sound",
            GroupName = "Spoof-like alerts",
            Order = 290)]
        public string SpoofAlertSound
        {
            get;
            set;
        }

        [Range(0, int.MaxValue)]
        [Display(
            Name = "Sound cooldown (ms)",
            GroupName = "Spoof-like alerts",
            Order = 300)]
        public int SpoofSoundCooldownMilliseconds
        {
            get;
            set;
        }

        #endregion

        #region Colors

        [XmlIgnore]
        [Display(
            ResourceType = typeof(Custom.Resource),
            Name = "NinjaScriptRecentColumnAskBackground",
            GroupName = "PropertyCategoryVisual",
            Order = 105)]
        public Brush AskBackColor
        {
            get;
            set;
        }

        [Browsable(false)]
        public string AskBackgroundBrushSerialize
        {
            get
            {
                return Gui.Serialize.BrushToString(
                    AskBackColor,
                    "brushAskPriceColumnBackground");
            }

            set
            {
                AskBackColor = Gui.Serialize.StringToBrush(
                    value,
                    "brushAskPriceColumnBackground");
            }
        }

        [XmlIgnore]
        [Display(
            ResourceType = typeof(Custom.Resource),
            Name = "NinjaScriptRecentColumnAskForeground",
            GroupName = "PropertyCategoryVisual",
            Order = 111)]
        public Brush AskForeColor
        {
            get;
            set;
        }

        [Browsable(false)]
        public string AskForeColorSerialize
        {
            get
            {
                return Gui.Serialize.BrushToString(
                    AskForeColor);
            }

            set
            {
                AskForeColor
                    = Gui.Serialize.StringToBrush(value);
            }
        }

        [XmlIgnore]
        [Display(
            ResourceType = typeof(Custom.Resource),
            Name = "NinjaScriptRecentColumnBidBackground",
            GroupName = "PropertyCategoryVisual",
            Order = 116)]
        public Brush BidBackColor
        {
            get;
            set;
        }

        [Browsable(false)]
        public string BidBackgroundBrushSerialize
        {
            get
            {
                return Gui.Serialize.BrushToString(
                    BidBackColor,
                    "brushBidPriceColumnBackground");
            }

            set
            {
                BidBackColor = Gui.Serialize.StringToBrush(
                    value,
                    "brushBidPriceColumnBackground");
            }
        }

        [XmlIgnore]
        [Display(
            ResourceType = typeof(Custom.Resource),
            Name = "NinjaScriptRecentColumnBidForeground",
            GroupName = "PropertyCategoryVisual",
            Order = 121)]
        public Brush BidForeColor
        {
            get;
            set;
        }

        [Browsable(false)]
        public string BidForeColorSerialize
        {
            get
            {
                return Gui.Serialize.BrushToString(
                    BidForeColor);
            }

            set
            {
                BidForeColor
                    = Gui.Serialize.StringToBrush(value);
            }
        }

        #endregion

        #endregion

        [TypeConverter(
            "NinjaTrader.Custom.ResourceEnumConverter")]
        public enum PullingStackingDisplayType
        {
            Ask,
            Bid,
            BidAsk
        }

        [TypeConverter(
            "NinjaTrader.Custom.ResourceEnumConverter")]
        public enum PullingStackingResetWhen
        {
            NoMoreData,
            BidAskChange
        }
    }

    #region v3 Rolling adapter
    // Additional v3 state is isolated from the copied legacy calculation/alerts.
    public enum ExecutionOSPullingStackingCalculationModeV3 { LegacyBaseline, RollingWindow }

    public partial class ExecutionOSPullingStacking_v3
    {
        private const string RollingBuildId = "2026-10-12.2";
        private ExecutionOSRollingLiquidityV3 rolling;
        private Timer rollingRefreshTimer;
        private BarsRequest rollingSessionRequest;
        private SessionIterator rollingSessionIterator;
        private Cbi.Instrument rollingInstrument;
        private bool v3Terminated;
        private bool connectionSubscribed;
        private long resetGeneration;
        private bool clockInitialized;
        private bool usingPlaybackClock;
        private long lastClockTicks;
        private bool wasConnected;
        private bool connectionInitialized;
        private int appliedWindowSeconds, appliedReconciliationMs, appliedDepthLevels;
        private ExecutionOSPullingStackingCalculationModeV3 appliedCalculationMode;
        private DateTime rollingSessionBegin = DateTime.MinValue;
        private DateTime rollingSessionEnd = DateTime.MinValue;
        private bool rollingSessionOpen;
        private string rollingCalendarError;
        private string rollingRuntimeError;
        private bool rollingNeedsSnapshot = true;
        private long rollingSourceFence;
        private long latestRollingSource;
        private string rollingLastResetReason = "Starting";
        private long lastDiagnosticTicks = long.MinValue;

        [Display(Name = "Log live rolling diagnostics", GroupName = "Rolling diagnostics", Order = 510)]
        public bool LogRollingDiagnostics { get; set; }

        [XmlIgnore]
        [ReadOnly(true)]
        [Display(Name = "Build", GroupName = "Rolling diagnostics", Order = 490)]
        public string RollingBuild { get { return RollingBuildId; } }

        [Display(Name = "Calculation mode", GroupName = "Rolling calculation", Order = 400)]
        public ExecutionOSPullingStackingCalculationModeV3 CalculationMode { get; set; }

        [Range(1, 30)]
        [Display(Name = "Rolling window (seconds)", GroupName = "Rolling calculation", Order = 410)]
        public int RollingWindowSeconds { get; set; }

        [Display(Name = "Apply legacy resets to rolling", GroupName = "Rolling calculation", Order = 420)]
        public bool ApplyLegacyResetsToRolling { get; set; }

        [Range(0, 1000)]
        [Display(Name = "Execution reconciliation (ms)", GroupName = "Rolling calculation", Order = 430)]
        public int ExecutionReconciliationMilliseconds { get; set; }

        [XmlIgnore]
        [ReadOnly(true)]
        [Display(Name = "Status", GroupName = "Rolling diagnostics", Order = 500)]
        public string RollingStatus
        {
            get
            {
                lock (collectionSync)
                {
                    if (CalculationMode != ExecutionOSPullingStackingCalculationModeV3.RollingWindow)
                        return "Legacy baseline";
                    if (State != State.Active || v3Terminated)
                        return "Settings view; enable live diagnostics for runtime status";
                    if (rollingRuntimeError != null) return "Unavailable: " + rollingRuntimeError;
                    if (rollingCalendarError != null) return "Unavailable: " + rollingCalendarError;
                    if (rollingSessionIterator == null) return "Waiting for instrument session calendar";
                    if (!rollingSessionOpen) return "Outside instrument trading session";
                    if (rolling == null) return "Waiting for depth";
                    if (rolling.Faulted) return "Unavailable: history capacity exceeded; click header to reset";
                    return (rolling.IsWarm ? "Estimated" : "Estimated; warming up")
                        + (rolling.IsProvisional ? "; reconciling" : "")
                        + "; matched " + rolling.MatchedVolume
                        + "; unmatched " + rolling.UnmatchedVolume
                        + "; unclassified " + rolling.UnclassifiedVolume
                        + "; continuity breaks " + rolling.ContinuityBreakCount
                        + "; invalid depth " + rolling.InvalidDepthCount
                        + "; source regressions " + rolling.TimestampRegressionCount
                        + "; unstamped depth " + rolling.UnstampedDepthCount
                        + "; known bid/ask " + rolling.KnownLevelCount(ExecutionOSRollingLiquidityV3.Side.Bid)
                        + "/" + rolling.KnownLevelCount(ExecutionOSRollingLiquidityV3.Side.Ask)
                        + "; resets " + rolling.ResetCount + "; last reset: " + rollingLastResetReason;
                }
            }
        }

        private long RawClockTicks()
        {
            if (Cbi.Connection.PlaybackConnection != null)
                return Cbi.Connection.PlaybackConnection.Now.Ticks;
            return (long)(System.Diagnostics.Stopwatch.GetTimestamp()
                * ((double)TimeSpan.TicksPerSecond / System.Diagnostics.Stopwatch.Frequency));
        }
        private DateTime SessionClockNow()
        {
            return Cbi.Connection.PlaybackConnection != null
                ? Cbi.Connection.PlaybackConnection.Now : Core.Globals.Now;
        }

        // Caller owns collectionSync. Receipt time is read *inside* this lock so
        // competing callback threads cannot manufacture a false clock rewind.
        private long EnsureV3Context()
        {
            long now = RawClockTicks();
            bool playback = Cbi.Connection.PlaybackConnection != null;
            if (clockInitialized && (playback != usingPlaybackClock || now < lastClockTicks))
                ResetV3FeedState(now, true);
            clockInitialized = true; usingPlaybackClock = playback; lastClockTicks = now;

            Cbi.Instrument instrument = SuperDom == null ? null : SuperDom.Instrument;
            if (!ReferenceEquals(instrument, rollingInstrument))
            {
                ResetV3FeedState(now, true);
                DisposeRollingCalendar(); rollingInstrument = instrument;
            }
            bool connected = SuperDom != null && SuperDom.IsConnected && !SuperDom.IsReloading;
            if (connectionInitialized && connected != wasConnected) ResetV3FeedState(now);
            wasConnected = connected; connectionInitialized = true;

            int levels = SuperDom == null ? 1 : Math.Max(1, Math.Min(4096, SuperDom.DepthLevels));
            if (rolling == null || appliedCalculationMode != CalculationMode
                || appliedWindowSeconds != RollingWindowSeconds
                || appliedReconciliationMs != ExecutionReconciliationMilliseconds
                || appliedDepthLevels != levels)
            {
                appliedCalculationMode = CalculationMode;
                appliedWindowSeconds = RollingWindowSeconds;
                appliedReconciliationMs = ExecutionReconciliationMilliseconds;
                appliedDepthLevels = levels;
                rolling = new ExecutionOSRollingLiquidityV3(RollingWindowSeconds,
                    ExecutionReconciliationMilliseconds, levels, 500000);
                rollingSourceFence = latestRollingSource;
                rolling.Reset(now); rolling.SetSourceFence(rollingSourceFence);
                rollingNeedsSnapshot = true; rollingRuntimeError = null;
                rollingLastResetReason = "Calculation settings changed";
                if (CalculationMode != ExecutionOSPullingStackingCalculationModeV3.RollingWindow)
                    DisposeRollingCalendar();
            }
            rolling.Advance(now);
            return now;
        }

        private bool MatchesInstrument(Cbi.Instrument instrument)
        {
            return SuperDom != null && SuperDom.Instrument != null
                && instrument != null && instrument.FullName == SuperDom.Instrument.FullName;
        }

        private static bool TryPriceTick(double price, double tickSize, out long tick)
        {
            tick = 0;
            if (double.IsNaN(price) || double.IsInfinity(price)
                || double.IsNaN(tickSize) || double.IsInfinity(tickSize) || tickSize <= 0) return false;
            double normalized = Math.Round(price / tickSize, MidpointRounding.AwayFromZero);
            if (normalized <= long.MinValue || normalized >= long.MaxValue
                || Math.Abs(price / tickSize - normalized) > 0.000001) return false;
            tick = (long)normalized; return true;
        }
        private bool TryRollingPrice(double price, out long tick)
        {
            tick = 0;
            return SuperDom != null && SuperDom.Instrument != null
                && TryPriceTick(price, SuperDom.Instrument.MasterInstrument.TickSize, out tick);
        }

        private void RecordRollingSource(DateTime source)
        {
            if (source != DateTime.MinValue && source.Ticks > latestRollingSource)
                latestRollingSource = source.Ticks;
        }

        private void ProcessRollingDepth(MarketDepthEventArgs depth, long now)
        {
            if (CalculationMode != ExecutionOSPullingStackingCalculationModeV3.RollingWindow
                || rolling == null || rollingRuntimeError != null) return;
            if (depth.MarketDataType != MarketDataType.Bid && depth.MarketDataType != MarketDataType.Ask) return;
            RecordRollingSource(depth.Time);
            if (depth.Operation == Cbi.Operation.Add && depth.Price.ApproxCompare(0) == 0 && depth.Volume == 0) return;
            long tick = 0;
            // Remove is addressed by the stored position, not its optional price.
            if (depth.Operation != Cbi.Operation.Remove && !TryRollingPrice(depth.Price, out tick))
            {
                rolling.Depth(depth.MarketDataType == MarketDataType.Ask
                    ? ExecutionOSRollingLiquidityV3.Side.Ask : ExecutionOSRollingLiquidityV3.Side.Bid,
                    ExecutionOSRollingLiquidityV3.DepthAction.Update, -1, 0, 0, 0, now);
                rollingNeedsSnapshot = true;
                return;
            }
            ExecutionOSRollingLiquidityV3.DepthAction action;
            if (depth.Operation == Cbi.Operation.Add) action = ExecutionOSRollingLiquidityV3.DepthAction.Add;
            else if (depth.Operation == Cbi.Operation.Update) action = ExecutionOSRollingLiquidityV3.DepthAction.Update;
            else if (depth.Operation == Cbi.Operation.Remove) action = ExecutionOSRollingLiquidityV3.DepthAction.Remove;
            else return;
            try
            {
                if (rollingNeedsSnapshot)
                {
                    SeedRollingSnapshot(now, depth, tick);
                    return;
                }
                bool accepted = rolling.Depth(depth.MarketDataType == MarketDataType.Ask
                    ? ExecutionOSRollingLiquidityV3.Side.Ask : ExecutionOSRollingLiquidityV3.Side.Bid,
                    action, depth.Position, tick, depth.Volume,
                    depth.Time == DateTime.MinValue ? 0 : depth.Time.Ticks, now);
                if (!accepted && !rolling.Faulted)
                { rollingNeedsSnapshot = true; rollingLastResetReason = "Depth continuity lost: " + rolling.LastContinuityFailure; }
            }
            catch (OverflowException) { rollingRuntimeError = "quantity overflow; click header to reset"; }
        }
        private bool SeedRollingSnapshot(long now, MarketDepthEventArgs trigger, long triggerPrice)
        {
            if (SuperDom == null || SuperDom.MarketDepth == null
                || SuperDom.MarketDepth.Instrument == null) return false;
            lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
            {
                bool alreadyReflected = false;
                rolling.Reset(now);
                for (int side = 0; side < 2; side++)
                {
                    var rows = side == 0 ? SuperDom.MarketDepth.Bids : SuperDom.MarketDepth.Asks;
                    // Keep the available positional book beyond the configured
                    // display depth; deeper callbacks must not look like a gap.
                    if (rows.Count > 4096)
                    { rollingRuntimeError = "depth snapshot exceeds book capacity"; return false; }
                    for (int i = 0; i < rows.Count; i++)
                    {
                        long price;
                        if (!TryRollingPrice(rows[i].Price, out price))
                        { rollingRuntimeError = "invalid depth snapshot"; return false; }
                        if (i == trigger.Position && price == triggerPrice && rows[i].Volume == trigger.Volume
                            && ((side == 0 && trigger.MarketDataType == MarketDataType.Bid)
                                || (side == 1 && trigger.MarketDataType == MarketDataType.Ask))) alreadyReflected = true;
                        rolling.Depth(side == 0 ? ExecutionOSRollingLiquidityV3.Side.Bid
                            : ExecutionOSRollingLiquidityV3.Side.Ask,
                            ExecutionOSRollingLiquidityV3.DepthAction.Add, i, price, rows[i].Volume, 0, now, true);
                    }
                }
                rollingSourceFence = latestRollingSource;
                rolling.PrepareSnapshot(now, rollingSourceFence);
                ExecutionOSRollingLiquidityV3.Side triggerSide = trigger.MarketDataType == MarketDataType.Ask
                    ? ExecutionOSRollingLiquidityV3.Side.Ask : ExecutionOSRollingLiquidityV3.Side.Bid;
                if (trigger.Operation != Cbi.Operation.Remove)
                {
                    if (alreadyReflected)
                        rolling.ConfirmSnapshotLevel(triggerSide, triggerPrice,
                            trigger.Time == DateTime.MinValue ? 0 : trigger.Time.Ticks);
                    else
                        // Callback/snapshot ordering is unknown for this row only.
                        rolling.RequireFreshLevel(triggerSide, triggerPrice);
                }
                rollingNeedsSnapshot = false;
                return alreadyReflected;
            }
        }
        private void ProcessRollingTrade(MarketDataEventArgs trade, long now)
        {
            if (CalculationMode != ExecutionOSPullingStackingCalculationModeV3.RollingWindow
                || rolling == null || rollingRuntimeError != null
                || !rollingSessionOpen || trade.MarketDataType != MarketDataType.Last || trade.Volume <= 0) return;
            RecordRollingSource(trade.Time);
            long price, bid, ask;
            if (!TryRollingPrice(trade.Price, out price)
                || !TryRollingPrice(trade.Bid, out bid) || !TryRollingPrice(trade.Ask, out ask)
                || bid >= ask || trade.Bid == double.MinValue || trade.Ask == double.MinValue)
            { rolling.Unclassified(trade.Volume); return; }
            ExecutionOSRollingLiquidityV3.Side side;
            if (price >= ask) side = ExecutionOSRollingLiquidityV3.Side.Ask;
            else if (price <= bid) side = ExecutionOSRollingLiquidityV3.Side.Bid;
            else { rolling.Unclassified(trade.Volume); return; }
            try { rolling.Trade(side, price, trade.Volume,
                trade.Time == DateTime.MinValue ? 0 : trade.Time.Ticks, now); }
            catch (OverflowException) { rollingRuntimeError = "quantity overflow; click header to reset"; }
        }
        private bool TryRollingValue(double price, bool isAsk, out long value)
        {
            value = 0; long tick;
            return rolling != null && rollingSessionIterator != null && rollingSessionOpen
                && rollingCalendarError == null && rollingRuntimeError == null
                && TryRollingPrice(price, out tick)
                && rolling.TryValue(isAsk ? ExecutionOSRollingLiquidityV3.Side.Ask
                    : ExecutionOSRollingLiquidityV3.Side.Bid, tick, out value);
        }
        private void ResetRollingHistory(string reason = "Header reset")
        {
            rollingLastResetReason = reason;
            rollingSourceFence = latestRollingSource;
            if (rolling != null) rolling.ResetHistory(RawClockTicks(), rollingSourceFence);
            rollingRuntimeError = null;
        }
        private void ResetRollingLevel(double price, bool isAsk)
        {
            if (!ApplyLegacyResetsToRolling || rolling == null) return;
            long tick;
            if (TryRollingPrice(price, out tick)) rolling.ResetLevel(isAsk
                ? ExecutionOSRollingLiquidityV3.Side.Ask : ExecutionOSRollingLiquidityV3.Side.Bid, tick);
            rollingLastResetReason = "Legacy no-data reset";
        }

        private void DisposeLegacyResetTimers()
        {
            if (bidAskResetTimer != null) { bidAskResetTimer.Dispose(); bidAskResetTimer = null; }
            if (askNoDataResetTimers != null)
            { foreach (Timer timer in askNoDataResetTimers.Values) timer.Dispose(); askNoDataResetTimers.Clear(); }
            if (bidNoDataResetTimers != null)
            { foreach (Timer timer in bidNoDataResetTimers.Values) timer.Dispose(); bidNoDataResetTimers.Clear(); }
        }
        private void ResetV3FeedState(long now, bool newSourceEpoch = false)
        {
            rollingLastResetReason = "Feed, connection, instrument or playback reset";
            resetGeneration++; DisposeLegacyResetTimers();
            if (askPriceDepthMap != null) askPriceDepthMap.Clear();
            if (bidPriceDepthMap != null) bidPriceDepthMap.Clear();
            if (mmAskPriceMap != null) mmAskPriceMap.Clear();
            if (mmBidPriceMap != null) mmBidPriceMap.Clear();
            if (askSpoofAlerts != null) ClearSpoofDetectionState();
            previousAsk = double.MinValue; previousBid = double.MinValue;
            if (newSourceEpoch) latestRollingSource = 0;
            rollingSourceFence = latestRollingSource; rollingNeedsSnapshot = true;
            if (rolling != null) { rolling.Reset(now); rolling.SetSourceFence(rollingSourceFence); }
            rollingRuntimeError = null; rollingSessionBegin = DateTime.MinValue;
            rollingSessionEnd = DateTime.MinValue; rollingSessionOpen = false;
        }
        private Timer CreateGuardedTimer(TimerCallback callback, object state, int due, int period)
        {
            long generation = resetGeneration;
            Timer timer = null;
            timer = new Timer(delegate(object ignored)
            {
                lock (collectionSync)
                {
                    if (v3Terminated || generation != resetGeneration) return;
                    if (callback == OnBidAskResetTimerCallback && !ReferenceEquals(timer, bidAskResetTimer)) return;
                    if (callback == OnSpoofAlertRefreshTimerCallback && !ReferenceEquals(timer, spoofAlertRefreshTimer)) return;
                    if (callback == OnNoDataResetTimerCallback)
                    {
                        Tuple<double, MarketDataType> key = (Tuple<double, MarketDataType>)state;
                        Dictionary<double, Timer> timers = key.Item2 == MarketDataType.Ask
                            ? askNoDataResetTimers : bidNoDataResetTimers;
                        Timer current;
                        if (!timers.TryGetValue(key.Item1, out current) || !ReferenceEquals(current, timer)) return;
                        timers.Remove(key.Item1); timer.Dispose();
                    }
                    callback(state);
                }
            }, null, due, period);
            return timer;
        }

        private void StartV3()
        {
            lock (collectionSync)
            {
                v3Terminated = false;
                if (!connectionSubscribed)
                { Cbi.Connection.ConnectionStatusUpdate += OnV3ConnectionStatus; connectionSubscribed = true; }
                EnsureV3Context();
                if (rollingRefreshTimer == null)
                    rollingRefreshTimer = new Timer(OnRollingRefresh, null, 100, 100);
            }
        }
        private void StopV3()
        {
            lock (collectionSync)
            {
                v3Terminated = true; resetGeneration++;
                if (connectionSubscribed)
                { Cbi.Connection.ConnectionStatusUpdate -= OnV3ConnectionStatus; connectionSubscribed = false; }
                if (rollingRefreshTimer != null) { rollingRefreshTimer.Dispose(); rollingRefreshTimer = null; }
                DisposeLegacyResetTimers(); DisposeRollingCalendar();
                if (rolling != null) rolling.Reset(RawClockTicks());
            }
        }
        private void OnV3ConnectionStatus(object sender, Cbi.ConnectionStatusEventArgs e)
        {
            // Conservative invalidation across price-feed interruptions; order-only
            // connection changes do not reset the column.
            Cbi.ConnectionStatus priceStatus = e.PriceStatus;
            if (priceStatus == e.PreviousPriceStatus) return;
            lock (collectionSync)
            {
                if (v3Terminated || State != State.Active) return;
                ResetV3FeedState(RawClockTicks());
                rollingCalendarError = null;
            }
            OnPropertyChanged();
        }
        private void DisposeRollingCalendar()
        {
            if (rollingSessionRequest != null) { rollingSessionRequest.Dispose(); rollingSessionRequest = null; }
            rollingSessionIterator = null; rollingCalendarError = null;
            rollingSessionBegin = DateTime.MinValue; rollingSessionEnd = DateTime.MinValue; rollingSessionOpen = false;
        }
        private void RequestRollingCalendar()
        {
            if (rollingSessionRequest != null || rollingSessionIterator != null || rollingCalendarError != null
                || rollingInstrument == null || SuperDom == null || !SuperDom.IsConnected) return;
            Cbi.Instrument instrument = rollingInstrument;
            // A one-bar request supplies NinjaTrader's holiday/DST-aware calendar;
            // no depth is synthesized from historical bars.
            rollingSessionRequest = new BarsRequest(instrument, 1)
            {
                BarsPeriod = new BarsPeriod { BarsPeriodType = BarsPeriodType.Minute, Value = 1 },
                TradingHours = instrument.MasterInstrument.TradingHours
            };
            BarsRequest owner = rollingSessionRequest;
            owner.Request(delegate(BarsRequest request, Cbi.ErrorCode code, string message)
            {
                lock (collectionSync)
                {
                    if (v3Terminated || !ReferenceEquals(request, rollingSessionRequest)
                        || !ReferenceEquals(instrument, rollingInstrument)) return;
                    if (code != Cbi.ErrorCode.NoError || request.Bars == null)
                    { rollingCalendarError = "session calendar request failed; reconnect or switch mode to retry";
                        request.Dispose(); rollingSessionRequest = null; return; }
                    try
                    {
                        rollingSessionIterator = new SessionIterator(request.Bars);
                        CheckRollingSession(RawClockTicks());
                    }
                    catch (Exception) { rollingCalendarError = "session calendar initialization failed"; }
                }
                OnPropertyChanged();
            });
        }
        private void CheckRollingSession(long nowTicks)
        {
            if (rollingSessionIterator == null || rollingCalendarError != null || rolling == null) return;
            DateTime now = SessionClockNow();
            bool initializing = rollingSessionBegin == DateTime.MinValue;
            bool changed = false;
            if (rollingSessionBegin == DateTime.MinValue || now < rollingSessionBegin || now >= rollingSessionEnd)
            {
                rollingSessionIterator.GetNextSession(now, false);
                DateTime begin = rollingSessionIterator.ActualSessionBegin;
                DateTime end = rollingSessionIterator.ActualSessionEnd;
                if (begin != rollingSessionBegin || end != rollingSessionEnd)
                    changed = true;
                rollingSessionBegin = begin; rollingSessionEnd = end;
            }
            bool open = now >= rollingSessionBegin && now < rollingSessionEnd;
            if (changed || open != rollingSessionOpen)
            {
                rollingSourceFence = latestRollingSource;
                // Initial calendar arrival validates the current session, without
                // invalidating a fresh startup snapshot taken in that session.
                if (initializing && open) rolling.ResetHistory(nowTicks, rollingSourceFence);
                else rolling.ResetObservations(nowTicks, rollingSourceFence);
                rollingLastResetReason = initializing ? "Session calendar ready" : "Session transition";
            }
            rollingSessionOpen = open;
        }
        private void OnRollingRefresh(object ignored)
        {
            bool refresh = false;
            string diagnostic = null;
            lock (collectionSync)
            {
                if (v3Terminated || State != State.Active) return;
                try
                {
                    long now = EnsureV3Context();
                    if (CalculationMode == ExecutionOSPullingStackingCalculationModeV3.RollingWindow)
                    {
                        RequestRollingCalendar(); CheckRollingSession(now);
                        // One coalesced 10 Hz refresh also covers quiet-market expiry.
                        refresh = true;
                    }
                }
                catch (Exception ex) { rollingRuntimeError = "refresh failure (" + ex.GetType().Name + ")"; refresh = true; }
                long diagnosticNow = (long)(System.Diagnostics.Stopwatch.GetTimestamp()
                    * ((double)TimeSpan.TicksPerSecond / System.Diagnostics.Stopwatch.Frequency));
                if (LogRollingDiagnostics && CalculationMode == ExecutionOSPullingStackingCalculationModeV3.RollingWindow
                    && (lastDiagnosticTicks == long.MinValue || diagnosticNow - lastDiagnosticTicks >= 5 * TimeSpan.TicksPerSecond))
                {
                    lastDiagnosticTicks = diagnosticNow;
                    diagnostic = "ExecutionOS P/S v3 [" + (rollingInstrument == null ? "no instrument" : rollingInstrument.FullName)
                        + "] build " + RollingBuildId + "; " + RollingStatus;
                }
            }
            if (diagnostic != null && !v3Terminated) Print(diagnostic);
            if (refresh && !v3Terminated) OnPropertyChanged();
        }
    }

    #endregion

    #region v3 Rolling calculation core
    // This core is embedded verbatim in ExecutionOSPullingStacking_v3.cs.
    // It owns no NinjaTrader objects, clocks, locks, timers, or UI resources.
    internal sealed class ExecutionOSRollingLiquidityV3
    {
        internal enum Side { Bid, Ask }
        internal enum DepthAction { Add, Update, Remove }

        private struct BookRow
        {
            internal long Price;
            internal long Quantity;
            internal BookRow(long price, long quantity) { Price = price; Quantity = quantity; }
        }
        private sealed class Contribution
        {
            internal long Receipt, StartSource, EndSource, Value;
            internal bool Expired;
        }
        private struct Execution
        {
            internal long Receipt, Source, Volume;
            internal Execution(long receipt, long source, long volume)
            { Receipt = receipt; Source = source; Volume = volume; }
        }
        private sealed class Level
        {
            internal bool Observed, RequireFreshObservation;
            internal long Quantity, Source, Sum;
            internal readonly Queue<Contribution> History = new Queue<Contribution>();
            internal readonly LinkedList<Contribution> Recent = new LinkedList<Contribution>();
            internal readonly Queue<Execution> Pending = new Queue<Execution>();
        }
        private sealed class Book
        {
            internal long LastSource;
            internal readonly List<BookRow> Rows = new List<BookRow>();
            internal readonly Dictionary<long, Level> Levels = new Dictionary<long, Level>();
        }

        private readonly Book bids = new Book();
        private readonly Book asks = new Book();
        private readonly List<long> prunePrices = new List<long>();
        private long lastNow = long.MinValue;
        private long started;
        private long sourceFence;
        private readonly long windowTicks;
        private readonly long graceTicks;
        private readonly int depthLimit;
        private readonly int capacity;
        internal int EntryCount { get; private set; }
        internal int PendingCount { get; private set; }
        internal long MatchedVolume { get; private set; }
        internal long UnmatchedVolume { get; private set; }
        internal long UnclassifiedVolume { get; private set; }
        internal long TimestampRegressionCount { get; private set; }
        internal long InvalidDepthCount { get; private set; }
        internal long ContinuityBreakCount { get; private set; }
        internal string LastContinuityFailure { get; private set; }
        internal long UnstampedDepthCount { get; private set; }
        internal long ResetCount { get; private set; }
        internal bool Faulted { get; private set; }
        internal bool IsWarm { get { return lastNow != long.MinValue && lastNow - started >= windowTicks; } }

        internal ExecutionOSRollingLiquidityV3(int seconds, int graceMilliseconds, int levels, int maximumEntries = 200000)
        {
            if (seconds < 1 || seconds > 30) throw new ArgumentOutOfRangeException("seconds");
            if (graceMilliseconds < 0 || graceMilliseconds > 1000) throw new ArgumentOutOfRangeException("graceMilliseconds");
            if (levels < 1 || levels > 4096) throw new ArgumentOutOfRangeException("levels");
            if (maximumEntries < 1) throw new ArgumentOutOfRangeException("maximumEntries");
            windowTicks = seconds * TimeSpan.TicksPerSecond;
            graceTicks = graceMilliseconds * TimeSpan.TicksPerMillisecond;
            depthLimit = levels;
            capacity = maximumEntries;
        }

        private Book GetBook(Side side) { return side == Side.Bid ? bids : asks; }
        internal void Reset(long now)
        {
            bids.Rows.Clear(); bids.Levels.Clear(); bids.LastSource = 0;
            asks.Rows.Clear(); asks.Levels.Clear(); asks.LastSource = 0;
            EntryCount = 0; PendingCount = 0; Faulted = false;
            lastNow = now; started = now; sourceFence = 0; ResetCount++;
        }

        // Explicit/manual/legacy reset of the measurement retains the known book.
        // Pending credits and all pre-reset contribution references are discarded.
        internal void SetSourceFence(long source) { if (source > sourceFence) sourceFence = source; }
        internal void ResetHistory(long now, long sourceCutoff = 0)
        {
            Advance(now);
            ResetBookHistory(bids); ResetBookHistory(asks);
            Faulted = false; started = now; ResetCount++;
            SetSourceFence(sourceCutoff);
        }
        // Session transitions retain positional identity but cannot compare an
        // old session's quantities with the first observation of the new session.
        internal void ResetObservations(long now, long sourceCutoff = 0)
        {
            ResetHistory(now, sourceCutoff);
            foreach (Level level in bids.Levels.Values)
            { level.Observed = false; level.RequireFreshObservation = true; }
            foreach (Level level in asks.Levels.Values)
            { level.Observed = false; level.RequireFreshObservation = true; }
        }
        private void ResetBookHistory(Book book)
        {
            foreach (Level level in book.Levels.Values)
            {
                DropHistory(level);
                // A measurement reset supplies no fresh provider timestamp for
                // these retained quantities. Never match across its boundary.
                level.Sum = 0; level.Source = 0;
            }
        }
        private void DropHistory(Level level)
        {
            EntryCount -= level.History.Count;
            PendingCount -= level.Pending.Count;
            foreach (Contribution entry in level.History) entry.Expired = true;
            level.History.Clear(); level.Recent.Clear(); level.Pending.Clear(); level.Sum = 0;
        }
        internal void ResetLevel(Side side, long price)
        {
            Level level;
            if (GetBook(side).Levels.TryGetValue(price, out level))
            { DropHistory(level); level.Source = 0; }
        }
        private void Invalidate(Level level)
        {
            DropHistory(level); level.Observed = false; level.RequireFreshObservation = false; level.Source = 0;
        }
        private void BreakContinuity(Book book, string reason)
        {
            foreach (Level level in book.Levels.Values) DropHistory(level);
            book.Rows.Clear(); book.Levels.Clear(); book.LastSource = 0;
            ContinuityBreakCount++;
            LastContinuityFailure = reason;
        }

        internal bool Advance(long now)
        {
            if (lastNow == long.MinValue) { lastNow = now; started = now; }
            if (now < lastNow) { Reset(now); return true; }
            lastNow = now;
            bool changed = ExpireBook(bids, now) | ExpireBook(asks, now);
            return changed;
        }
        private bool ExpireBook(Book book, long now)
        {
            bool changed = false;
            long cutoff = now - windowTicks;
            long reconcileCutoff = now - graceTicks;
            prunePrices.Clear();
            foreach (KeyValuePair<long, Level> pair in book.Levels)
            {
                Level level = pair.Value;
                while (level.History.Count > 0 && level.History.Peek().Receipt <= cutoff)
                {
                    Contribution entry = level.History.Dequeue();
                    level.Sum -= entry.Value; entry.Expired = true; EntryCount--; changed = true;
                }
                while (level.Recent.First != null && level.Recent.First.Value.Receipt < reconcileCutoff)
                    level.Recent.RemoveFirst();
                while (level.Pending.Count > 0 && level.Pending.Peek().Receipt < reconcileCutoff)
                {
                    UnmatchedVolume += level.Pending.Dequeue().Volume;
                    PendingCount--; changed = true;
                }
                if (level.History.Count == 0 && level.Recent.Count == 0 && level.Pending.Count == 0
                    && !ContainsPrice(book, pair.Key)) prunePrices.Add(pair.Key);
            }
            foreach (long price in prunePrices) book.Levels.Remove(price);
            return changed;
        }
        private bool ContainsPrice(Book book, long price)
        {
            foreach (BookRow row in book.Rows) if (row.Price == price) return true;
            return false;
        }
        private bool Visible(Book book, long price)
        {
            int count = Math.Min(depthLimit, book.Rows.Count);
            for (int i = 0; i < count; i++) if (book.Rows[i].Price == price) return true;
            return false;
        }
        private long Quantity(Book book, long price)
        {
            long result = 0;
            for (int i = 0; i < Math.Min(depthLimit, book.Rows.Count); i++)
                if (book.Rows[i].Price == price) result = checked(result + book.Rows[i].Quantity);
            return result;
        }
        private Level GetLevel(Book book, long price)
        {
            Level level;
            if (!book.Levels.TryGetValue(price, out level))
            { level = new Level(); book.Levels.Add(price, level); }
            return level;
        }
        private void Seed(Level level, long quantity, long source)
        {
            DropHistory(level); level.Quantity = quantity; level.Source = source;
            level.Observed = true; level.RequireFreshObservation = false;
        }
        // A caller that atomically captured the existing DOM may confirm the
        // triggering price without applying its already-reflected Add twice.
        internal void ConfirmSnapshotLevel(Side side, long price, long source)
        {
            Book book = GetBook(side);
            if (source > 0 && source < sourceFence) return;
            if (!Visible(book, price)) return;
            Seed(GetLevel(book, price), Quantity(book, price), source);
            if (source > book.LastSource) book.LastSource = source;
        }

        // A current, atomic DOM snapshot observes every captured quantity. Its
        // rows have no individual event timestamps, so the first delta cannot
        // receive execution credit through a fabricated source-time interval.
        internal void PrepareSnapshot(long now, long sourceCutoff)
        {
            ResetHistory(now, sourceCutoff);
            bids.LastSource = 0; asks.LastSource = 0;
            foreach (Level level in bids.Levels.Values) level.Source = 0;
            foreach (Level level in asks.Levels.Values) level.Source = 0;
        }
        internal void RequireFreshLevel(Side side, long price)
        {
            Level level;
            if (!GetBook(side).Levels.TryGetValue(price, out level)) return;
            DropHistory(level); level.Observed = false;
            level.RequireFreshObservation = true; level.Source = 0;
        }
        internal int KnownLevelCount(Side side)
        {
            Book book = GetBook(side); int count = 0;
            foreach (KeyValuePair<long, Level> pair in book.Levels)
                if (pair.Value.Observed && Visible(book, pair.Key)) count++;
            return count;
        }

        internal bool Depth(Side side, DepthAction action, int position, long price, long quantity, long source, long now,
            bool isSnapshot = false)
        {
            Advance(now);
            if (Faulted) return false;
            Book book = GetBook(side);
            if (quantity < 0 || position < 0 || position > book.Rows.Count
                || (action == DepthAction.Remove && position == book.Rows.Count)
                || (action == DepthAction.Add && book.Rows.Count >= 4096))
            {
                InvalidDepthCount++;
                BreakContinuity(book, side + " " + action + " position " + position
                    + " / stored rows " + book.Rows.Count + "; quantity " + quantity);
                return false;
            }
            // NinjaTrader guarantees depth callback sequence, not that every
            // provider timestamp equals or exceeds the local receipt clock.
            // Regressing source times make attribution uncertain, not the book's
            // ordered quantities. Keep history, discard ambiguous trade matches.
            if (source > 0 && book.LastSource > 0 && source < book.LastSource)
            {
                TimestampRegressionCount++;
                foreach (Level level in book.Levels.Values)
                {
                    while (level.Pending.Count > 0)
                    { UnmatchedVolume += level.Pending.Dequeue().Volume; PendingCount--; }
                    level.Recent.Clear(); level.Source = 0;
                }
                source = 0;
            }
            else if (source > 0) book.LastSource = source;
            else if (!isSnapshot) UnstampedDepthCount++;

            long oldPrice = price;
            bool hasOld = action != DepthAction.Add && position < book.Rows.Count;
            bool outerRemoval = action == DepthAction.Remove
                && position >= Math.Min(depthLimit, book.Rows.Count) - 1;
            if (hasOld) oldPrice = book.Rows[position].Price;
            if (action == DepthAction.Add)
                book.Rows.Insert(position, new BookRow(price, quantity));
            else if (action == DepthAction.Remove)
                book.Rows.RemoveAt(position);
            else if (hasOld)
                book.Rows[position] = new BookRow(price, quantity);
            else
                book.Rows.Add(new BookRow(price, quantity)); // Bootstrap Update at the next position.

            if (hasOld && (action == DepthAction.Remove || oldPrice != price))
            {
                Level oldLevel;
                if (book.Levels.TryGetValue(oldPrice, out oldLevel))
                {
                    if (outerRemoval || (!Visible(book, oldPrice) && ContainsPrice(book, oldPrice)))
                        Invalidate(oldLevel);
                    else Observe(oldLevel, Quantity(book, oldPrice), source, now);
                }
            }
            if (action != DepthAction.Remove && Visible(book, price))
                Observe(GetLevel(book, price), Quantity(book, price), source, now);

            // Shifts can take a previously visible level out of subscription coverage,
            // or bring one back without an event directly addressing that price.
            foreach (KeyValuePair<long, Level> pair in book.Levels)
            {
                if (pair.Value.Observed && ContainsPrice(book, pair.Key) && !Visible(book, pair.Key))
                    Invalidate(pair.Value);
            }
            for (int i = 0; i < Math.Min(depthLimit, book.Rows.Count); i++)
            {
                long visiblePrice = book.Rows[i].Price;
                Level level = GetLevel(book, visiblePrice);
                if (!level.Observed && !level.RequireFreshObservation)
                    Seed(level, Quantity(book, visiblePrice), source);
            }
            return !Faulted;
        }
        private void Observe(Level level, long quantity, long source, long now)
        {
            if (!level.Observed) { Seed(level, quantity, source); return; }
            if (EntryCount + PendingCount >= capacity) { Faulted = true; return; }
            Contribution entry = new Contribution
            {
                Receipt = now, StartSource = level.Source, EndSource = source,
                Value = checked(quantity - level.Quantity)
            };
            level.History.Enqueue(entry); level.Recent.AddLast(entry); EntryCount++;
            level.Sum = checked(level.Sum + entry.Value);
            level.Quantity = quantity; level.Source = source;

            int count = level.Pending.Count;
            for (int i = 0; i < count; i++)
            {
                Execution trade = level.Pending.Dequeue();
                if (CanAllocate(trade, entry))
                { Allocate(level, entry, trade.Volume); PendingCount--; }
                else level.Pending.Enqueue(trade);
            }
        }
        private bool CanAllocate(Execution trade, Contribution entry)
        {
            return !entry.Expired && trade.Source > 0 && entry.StartSource > 0 && entry.EndSource > 0
                && trade.Source >= entry.StartSource && trade.Source <= entry.EndSource
                && Math.Abs(trade.Receipt - entry.Receipt) <= graceTicks;
        }
        private void Allocate(Level level, Contribution entry, long volume)
        {
            // No cap to the negative depth change: executions plus net-unchanged
            // depth imply replenishment, and additions may coexist with executions.
            entry.Value = checked(entry.Value + volume);
            level.Sum = checked(level.Sum + volume);
            MatchedVolume = checked(MatchedVolume + volume);
        }
        internal void Unclassified(long volume) { if (volume > 0) UnclassifiedVolume += volume; }
        internal void Trade(Side side, long price, long volume, long source, long now)
        {
            Advance(now);
            if (Faulted || volume <= 0) return;
            Book book = GetBook(side);
            Level level;
            if (source <= 0 || (sourceFence > 0 && source <= sourceFence)
                || !book.Levels.TryGetValue(price, out level) || !level.Observed)
            { UnmatchedVolume += volume; return; }
            Execution trade = new Execution(now, source, volume);
            foreach (Contribution entry in level.Recent)
            {
                if (CanAllocate(trade, entry)) { Allocate(level, entry, volume); return; }
            }
            if (EntryCount + PendingCount >= capacity) { Faulted = true; return; }
            level.Pending.Enqueue(trade); PendingCount++;
        }
        internal bool TryValue(Side side, long price, out long value)
        {
            value = 0;
            Level level;
            if (Faulted || !GetBook(side).Levels.TryGetValue(price, out level) || !level.Observed) return false;
            value = level.Sum; return true;
        }
        internal bool IsProvisional
        {
            get
            {
                if (PendingCount > 0) return true;
                foreach (Level level in bids.Levels.Values) if (level.Recent.Count > 0) return true;
                foreach (Level level in asks.Levels.Values) if (level.Recent.Count > 0) return true;
                return false;
            }
        }
    }

    #endregion
}
