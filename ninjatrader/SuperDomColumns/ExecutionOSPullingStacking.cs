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
    public class ExecutionOSPullingStacking : SuperDomColumn
    {
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
        private double textHeight;
        private Typeface typeFace;

        public override void OnColumnLabelClicked(object sender, MouseButtonEventArgs e)
        {
            lock (collectionSync)
            {
                askNoDataResetTimers.Clear();
                bidNoDataResetTimers.Clear();
                askPriceDepthMap.Clear();
                bidPriceDepthMap.Clear();
                mmAskPriceMap.Clear();
                mmBidPriceMap.Clear();
                if (SuperDom == null || SuperDom.MarketDepth == null || SuperDom.MarketDepth.Instrument == null)
                    return;
                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                {
                    for (int i = 0; i < SuperDom.MarketDepth.Asks.Count; i++)
                        askPriceDepthMap.Add(SuperDom.MarketDepth.Asks[i].Price, Tuple.Create(SuperDom.MarketDepth.Asks[i].Volume, 0L));
                    for (int i = 0; i < SuperDom.MarketDepth.Bids.Count; i++)
                        bidPriceDepthMap.Add(SuperDom.MarketDepth.Bids[i].Price, Tuple.Create(SuperDom.MarketDepth.Bids[i].Volume, 0L));
                }
                OnPropertyChanged();
            }
        }

        protected override void OnMarketData(MarketDataEventArgs marketData)
        {
            if (marketData.MarketDataType == MarketDataType.Last)
            {
                lock (collectionSync)
                {
                    Tuple<long, long> depthTuple;

                    if (askPriceDepthMap.TryGetValue(marketData.Price, out depthTuple))
                    {
                        askPriceDepthMap[marketData.Price] = Tuple.Create(
                            depthTuple.Item1 - marketData.Volume,
                            depthTuple.Item2 - marketData.Volume);
                    }

                    if (bidPriceDepthMap.TryGetValue(marketData.Price, out depthTuple))
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
                    && (previousAsk <= double.MinValue || previousAsk.ApproxCompare(marketData.Price) != 0))
                {
                    if (previousAsk > double.MinValue)
                    {
                        if (bidAskResetTimer != null)
                            bidAskResetTimer.Dispose();

                        bidAskResetTimer = new Timer(
                            OnBidAskResetTimerCallback,
                            Tuple.Create(marketData.Price, marketData.MarketDataType),
                            ResetTolerance,
                            Timeout.Infinite);
                    }

                    previousAsk = marketData.Price;
                }
                else if (marketData.MarketDataType == MarketDataType.Bid
                    && (previousBid <= double.MinValue || previousBid.ApproxCompare(marketData.Price) != 0))
                {
                    if (previousBid > double.MinValue)
                    {
                        if (bidAskResetTimer != null)
                            bidAskResetTimer.Dispose();

                        bidAskResetTimer = new Timer(
                            OnBidAskResetTimerCallback,
                            Tuple.Create(marketData.Price, marketData.MarketDataType),
                            ResetTolerance,
                            Timeout.Infinite);
                    }

                    previousBid = marketData.Price;
                }
            }
        }

        protected override void OnMarketDepth(MarketDepthEventArgs marketDepth)
        {
            if (marketDepth.IsReset)
            {
                lock (collectionSync)
                {
                    askNoDataResetTimers.Clear();
                    bidNoDataResetTimers.Clear();
                    askPriceDepthMap.Clear();
                    bidPriceDepthMap.Clear();
                    mmAskPriceMap.Clear();
                    mmBidPriceMap.Clear();
                }

                OnPropertyChanged();
                return;
            }

            if (SuperDom == null
                || SuperDom.MarketDepth == null
                || SuperDom.MarketDepth.Instrument == null)
            {
                return;
            }

            if (marketDepth.Position >= SuperDom.DepthLevels)
                return;

            lock (collectionSync)
            {
                if (marketDepth.MarketDataType == MarketDataType.Ask)
                {
                    ProcessAskDepth(marketDepth);
                }
                else if (marketDepth.MarketDataType == MarketDataType.Bid)
                {
                    ProcessBidDepth(marketDepth);
                }
            }
        }

        private void ProcessAskDepth(MarketDepthEventArgs marketDepth)
        {
            if (marketDepth.Operation == Cbi.Operation.Add)
            {
                if (marketDepth.Price.ApproxCompare(0) == 0 && marketDepth.Volume == 0)
                    return;

                PriceRow row;
                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                {
                    row = SuperDom.Rows.FirstOrDefault(
                        r => r.Price.ApproxCompare(marketDepth.Price) == 0);
                }

                if (!string.IsNullOrEmpty(marketDepth.MarketMaker))
                    mmAskPriceMap[marketDepth.MarketMaker] = marketDepth.Price;

                Tuple<long, long> existingDepth;
                if (askPriceDepthMap.TryGetValue(marketDepth.Price, out existingDepth)
                    && existingDepth.Item1 > 0)
                {
                    askPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        existingDepth.Item1,
                        marketDepth.Volume - existingDepth.Item1);
                }
                else
                {
                    long baselineVolume = row != null
                        ? row.AskVolume
                        : marketDepth.Volume;

                    askPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        baselineVolume,
                        0L);
                }

                return;
            }

            if (marketDepth.Operation == Cbi.Operation.Update)
            {
                Tuple<long, long> depthTuple;
                if (askPriceDepthMap.TryGetValue(marketDepth.Price, out depthTuple))
                {
                    askPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        depthTuple.Item1,
                        marketDepth.Volume - depthTuple.Item1);
                }
                else
                {
                    askPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        marketDepth.Volume,
                        0L);
                }

                return;
            }

            if (ResetWhen != PullingStackingResetWhen.NoMoreData)
                return;

            double price = marketDepth.Price;
            if (!string.IsNullOrEmpty(marketDepth.MarketMaker))
            {
                double mmPrice;
                if (mmAskPriceMap.TryGetValue(marketDepth.MarketMaker, out mmPrice))
                    price = mmPrice;
            }

            PriceRow noDataRow;
            lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
            {
                noDataRow = SuperDom.Rows.FirstOrDefault(
                    r => r.Price.ApproxCompare(price) == 0);
            }

            if (noDataRow == null || noDataRow.AskVolume > 0)
                return;

            Timer existingTimer;
            if (askNoDataResetTimers.TryGetValue(price, out existingTimer))
                existingTimer.Dispose();

            askNoDataResetTimers[price] = new Timer(
                OnNoDataResetTimerCallback,
                Tuple.Create(price, MarketDataType.Ask),
                ResetTolerance,
                Timeout.Infinite);
        }

        private void ProcessBidDepth(MarketDepthEventArgs marketDepth)
        {
            if (marketDepth.Operation == Cbi.Operation.Add)
            {
                if (marketDepth.Price.ApproxCompare(0) == 0 && marketDepth.Volume == 0)
                    return;

                PriceRow row;
                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                {
                    row = SuperDom.Rows.FirstOrDefault(
                        r => r.Price.ApproxCompare(marketDepth.Price) == 0);
                }

                if (!string.IsNullOrEmpty(marketDepth.MarketMaker))
                    mmBidPriceMap[marketDepth.MarketMaker] = marketDepth.Price;

                Tuple<long, long> existingDepth;
                if (bidPriceDepthMap.TryGetValue(marketDepth.Price, out existingDepth)
                    && existingDepth.Item1 > 0)
                {
                    bidPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        existingDepth.Item1,
                        marketDepth.Volume - existingDepth.Item1);
                }
                else
                {
                    long baselineVolume = row != null
                        ? row.BidVolume
                        : marketDepth.Volume;

                    bidPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        baselineVolume,
                        0L);
                }

                return;
            }

            if (marketDepth.Operation == Cbi.Operation.Update)
            {
                Tuple<long, long> depthTuple;
                if (bidPriceDepthMap.TryGetValue(marketDepth.Price, out depthTuple))
                {
                    bidPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        depthTuple.Item1,
                        marketDepth.Volume - depthTuple.Item1);
                }
                else
                {
                    bidPriceDepthMap[marketDepth.Price] = Tuple.Create(
                        marketDepth.Volume,
                        0L);
                }

                return;
            }

            if (ResetWhen != PullingStackingResetWhen.NoMoreData)
                return;

            double price = marketDepth.Price;
            if (!string.IsNullOrEmpty(marketDepth.MarketMaker))
            {
                double mmPrice;
                if (mmBidPriceMap.TryGetValue(marketDepth.MarketMaker, out mmPrice))
                    price = mmPrice;
            }

            PriceRow noDataRow;
            lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
            {
                noDataRow = SuperDom.Rows.FirstOrDefault(
                    r => r.Price.ApproxCompare(price) == 0);
            }

            if (noDataRow == null || noDataRow.BidVolume > 0)
                return;

            Timer existingTimer;
            if (bidNoDataResetTimers.TryGetValue(price, out existingTimer))
                existingTimer.Dispose();

            bidNoDataResetTimers[price] = new Timer(
                OnNoDataResetTimerCallback,
                Tuple.Create(price, MarketDataType.Bid),
                ResetTolerance,
                Timeout.Infinite);
        }

        protected override void OnRender(DrawingContext dc, double renderWidth)
        {
            // This may be true if the UI for a column has not been loaded yet.
            if (gridPen == null && UiWrapper != null)
            {
                PresentationSource source = PresentationSource.FromVisual(UiWrapper);
                if (source != null && source.CompositionTarget != null)
                {
                    Matrix matrix = source.CompositionTarget.TransformToDevice;
                    double dpiFactor = 1.0 / matrix.M11;

                    gridPen = new Pen(
                        Application.Current.TryFindResource("BorderThinBrush") as Brush,
                        1.0 * dpiFactor);

                    halfPenWidth = gridPen.Thickness * 0.5;
                }
            }

            if (!Equals(fontFamily, SuperDom.Font.Family)
                || (SuperDom.Font.Italic && fontStyle != FontStyles.Italic)
                || (!SuperDom.Font.Italic && fontStyle == FontStyles.Italic)
                || (SuperDom.Font.Bold && fontWeight != FontWeights.Bold)
                || (!SuperDom.Font.Bold && fontWeight == FontWeights.Bold))
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
                : VisualTreeHelper.GetDpi(UiWrapper).PixelsPerDip;

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

                    GuidelineSet guidelines = new GuidelineSet();
                    guidelines.GuidelinesX.Add(rect.Left + halfPenWidth);
                    guidelines.GuidelinesX.Add(rect.Right + halfPenWidth);
                    guidelines.GuidelinesY.Add(rect.Top + halfPenWidth);
                    guidelines.GuidelinesY.Add(rect.Bottom + halfPenWidth);
                    dc.PushGuidelineSet(guidelines);

                    if (DisplayType == PullingStackingDisplayType.BidAsk)
                    {
                        Rect bidRect = new Rect(
                            -halfPenWidth,
                            verticalOffset,
                            renderWidth / 2.0 - halfPenWidth,
                            SuperDom.ActualRowHeight);

                        Rect askRect = new Rect(
                            renderWidth / 2.0 - halfPenWidth,
                            verticalOffset,
                            renderWidth / 2.0 - halfPenWidth,
                            SuperDom.ActualRowHeight);

                        dc.DrawRectangle(BidBackColor, null, bidRect);
                        dc.DrawRectangle(AskBackColor, null, askRect);
                    }
                    else if (DisplayType == PullingStackingDisplayType.Ask)
                    {
                        dc.DrawRectangle(AskBackColor, null, rect);
                    }
                    else if (DisplayType == PullingStackingDisplayType.Bid)
                    {
                        dc.DrawRectangle(BidBackColor, null, rect);
                    }

                    if (gridPen != null)
                    {
                        dc.DrawLine(
                            gridPen,
                            new Point(-gridPen.Thickness, rect.Bottom),
                            new Point(renderWidth - halfPenWidth, rect.Bottom));

                        dc.DrawLine(
                            gridPen,
                            new Point(rect.Right, verticalOffset),
                            new Point(rect.Right, rect.Bottom));
                    }

                    if (SuperDom.IsConnected
                        && !SuperDom.IsReloading
                        && State == State.Active)
                    {
                        lock (collectionSync)
                        {
                            DrawBidValue(dc, row, renderWidth, verticalOffset, pixelsPerDip);
                            DrawAskValue(dc, row, renderWidth, verticalOffset, pixelsPerDip);
                        }
                    }

                    dc.Pop();
                    verticalOffset += SuperDom.ActualRowHeight;
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
            if (DisplayType != PullingStackingDisplayType.BidAsk
                && DisplayType != PullingStackingDisplayType.Bid)
            {
                return;
            }

            Tuple<long, long> bidVolume;
            if (!bidPriceDepthMap.TryGetValue(row.Price, out bidVolume)
                || row.BidVolume <= 0
                || renderWidth / 2.0 - 6.0 <= 0)
            {
                return;
            }

            Typeface currentTypeface = new Typeface(
                SuperDom.Font.Family,
                SuperDom.Font.Italic ? FontStyles.Italic : FontStyles.Normal,
                SuperDom.Font.Bold ? FontWeights.Bold : FontWeights.Normal,
                FontStretches.Normal);

            FormattedText bidText = new FormattedText(
                bidVolume.Item2.ToString(Core.Globals.GeneralOptions.CurrentCulture),
                Core.Globals.GeneralOptions.CurrentCulture,
                FlowDirection.LeftToRight,
                currentTypeface,
                SuperDom.Font.Size,
                BidForeColor,
                pixelsPerDip);

            bidText.MaxLineCount = 1;
            bidText.MaxTextWidth = renderWidth / 2.0 - 6.0;
            bidText.Trimming = TextTrimming.CharacterEllipsis;

            if (heightUpdateNeeded)
            {
                textHeight = bidText.Height;
                heightUpdateNeeded = false;
            }

            dc.DrawText(
                bidText,
                new Point(
                    4.0,
                    verticalOffset + (SuperDom.ActualRowHeight - textHeight) / 2.0));
        }

        private void DrawAskValue(
            DrawingContext dc,
            PriceRow row,
            double renderWidth,
            double verticalOffset,
            double pixelsPerDip)
        {
            if (DisplayType != PullingStackingDisplayType.BidAsk
                && DisplayType != PullingStackingDisplayType.Ask)
            {
                return;
            }

            Tuple<long, long> askVolume;
            if (!askPriceDepthMap.TryGetValue(row.Price, out askVolume)
                || row.AskVolume <= 0
                || renderWidth / 2.0 - 6.0 <= 0)
            {
                return;
            }

            Typeface currentTypeface = new Typeface(
                SuperDom.Font.Family,
                SuperDom.Font.Italic ? FontStyles.Italic : FontStyles.Normal,
                SuperDom.Font.Bold ? FontWeights.Bold : FontWeights.Normal,
                FontStretches.Normal);

            FormattedText askText = new FormattedText(
                askVolume.Item2.ToString(Core.Globals.GeneralOptions.CurrentCulture),
                Core.Globals.GeneralOptions.CurrentCulture,
                FlowDirection.LeftToRight,
                currentTypeface,
                SuperDom.Font.Size,
                AskForeColor,
                pixelsPerDip);

            askText.MaxLineCount = 1;
            askText.MaxTextWidth = renderWidth / 2.0 - 6.0;
            askText.Trimming = TextTrimming.CharacterEllipsis;

            if (heightUpdateNeeded)
            {
                textHeight = askText.Height;
                heightUpdateNeeded = false;
            }

            dc.DrawText(
                askText,
                new Point(
                    renderWidth / 2.0 + 4.0,
                    verticalOffset + (SuperDom.ActualRowHeight - textHeight) / 2.0));
        }

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "ExecutionOS Pulling/Stacking";
                Description = Gui.Resource.NinjaScriptSuperdomColumnPullingStackingDescription;
                DefaultWidth = 100;
                PreviousWidth = -1;
                IsDataSeriesRequired = false;

                AskBackColor = Application.Current.TryFindResource(
                    "brushPriceColumnBackground") as Brush;
                AskForeColor = Application.Current.TryFindResource(
                    "brushVolumeColumnForeground") as SolidColorBrush;
                BidBackColor = Application.Current.TryFindResource(
                    "brushPriceColumnBackground") as Brush;
                BidForeColor = Application.Current.TryFindResource(
                    "brushVolumeColumnForeground") as SolidColorBrush;

                askNoDataResetTimers = new Dictionary<double, Timer>();
                bidNoDataResetTimers = new Dictionary<double, Timer>();
                askPriceDepthMap = new Dictionary<double, Tuple<long, long>>();
                bidPriceDepthMap = new Dictionary<double, Tuple<long, long>>();
                mmAskPriceMap = new Dictionary<string, double>();
                mmBidPriceMap = new Dictionary<string, double>();

                DisplayType = PullingStackingDisplayType.BidAsk;
                ResetWhen = PullingStackingResetWhen.BidAskChange;
                ResetTolerance = 2500;
            }
            else if (State == State.Configure)
            {
                if (UiWrapper != null)
                {
                    PresentationSource source = PresentationSource.FromVisual(UiWrapper);
                    if (source != null && source.CompositionTarget != null)
                    {
                        Matrix matrix = source.CompositionTarget.TransformToDevice;
                        double dpiFactor = 1.0 / matrix.M11;

                        gridPen = new Pen(
                            Application.Current.TryFindResource("BorderThinBrush") as Brush,
                            1.0 * dpiFactor);

                        halfPenWidth = gridPen.Thickness * 0.5;
                    }
                }
            }
            else if (State == State.Terminated)
            {
                if (bidAskResetTimer != null)
                {
                    bidAskResetTimer.Dispose();
                    bidAskResetTimer = null;
                }
            }
        }

        private void OnBidAskResetTimerCallback(object state)
        {
            // This resets the entire column when the bid or ask changes after a tolerance period
            lock (collectionSync)
            {
                if (SuperDom == null
                    || SuperDom.Instrument == null
                    || SuperDom.Instrument.MarketData == null
                    || SuperDom.Instrument.MarketData.Ask == null
                    || SuperDom.Instrument.MarketData.Bid == null)
                {
                    askPriceDepthMap.Clear();
                    bidPriceDepthMap.Clear();
                    mmAskPriceMap.Clear();
                    mmBidPriceMap.Clear();
                    return;
                }
                Tuple<double, MarketDataType> priorPrice = (Tuple<double, MarketDataType>)state;
                if (priorPrice.Item2 == MarketDataType.Ask)
                {
                    if (priorPrice.Item1.ApproxCompare(SuperDom.Instrument.MarketData.Ask.Price) == 0)
                        return;
                }
                else if (priorPrice.Item2 == MarketDataType.Bid)
                {
                    if (priorPrice.Item1.ApproxCompare(SuperDom.Instrument.MarketData.Bid.Price) == 0)
                        return;
                }
                askPriceDepthMap.Clear();
                bidPriceDepthMap.Clear();
                mmAskPriceMap.Clear();
                mmBidPriceMap.Clear();
                if (SuperDom.MarketDepth == null)
                    return;
                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                {
                    for (int i = 0; i < SuperDom.MarketDepth.Asks.Count; i++)
                        askPriceDepthMap[SuperDom.MarketDepth.Asks[i].Price] = Tuple.Create(SuperDom.MarketDepth.Asks[i].Volume, 0L);
                    for (int i = 0; i < SuperDom.MarketDepth.Bids.Count; i++)
                        bidPriceDepthMap[SuperDom.MarketDepth.Bids[i].Price] = Tuple.Create(SuperDom.MarketDepth.Bids[i].Volume, 0L);
                }
            }
        }

        private void OnNoDataResetTimerCallback(object state)
        {
            // This resets only the bid or ask price level when no data has been received after a tolerance period
            if (SuperDom == null
                || SuperDom.MarketDepth == null
                || SuperDom.MarketDepth.Instrument == null)
            {
                return;
            }

            lock (collectionSync)
            {
                Tuple<double, MarketDataType> priorPrice = (Tuple<double, MarketDataType>)state;
                lock (SuperDom.MarketDepth.Instrument.SyncMarketDepth)
                    if (priorPrice.Item2 == MarketDataType.Ask)
                    {
                        MarketDepthRow row = SuperDom.MarketDepth.Asks.FirstOrDefault(a => a.Price.ApproxCompare(priorPrice.Item1) == 0);
                        if (row == null || row.Volume == 0)
                            askPriceDepthMap[priorPrice.Item1] = Tuple.Create(0L, 0L);
                    }
                    else if (priorPrice.Item2 == MarketDataType.Bid)
                    {
                        MarketDepthRow row = SuperDom.MarketDepth.Bids.FirstOrDefault(a => a.Price.ApproxCompare(priorPrice.Item1) == 0);
                        if (row == null || row.Volume == 0)
                            bidPriceDepthMap[priorPrice.Item1] = Tuple.Create(0L, 0L);
                    }
            }
        }

        #region Properties

        #region Setup
        [Display(ResourceType = typeof(Custom.Resource), Name = "NinjaScriptRecentColumnDiplay", GroupName = "NinjaScriptSetup", Order = 100)]
        public PullingStackingDisplayType DisplayType { get; set; }
        [Display(ResourceType = typeof(Custom.Resource), Name = "NinjaScriptRecentColumnResetWhen", GroupName = "NinjaScriptSetup", Order = 110)]
        public PullingStackingResetWhen ResetWhen { get; set; }
        [Display(ResourceType = typeof(Custom.Resource), Name = "NinjaScriptRecentColumnResetTolerance", GroupName = "NinjaScriptSetup", Order = 115)]
        [Range(1, int.MaxValue)]
        public int ResetTolerance { get; set; }

        #endregion

        #region Colors
        [XmlIgnore]
        [Display(ResourceType = typeof(Custom.Resource), Name = "NinjaScriptRecentColumnAskBackground", GroupName = "PropertyCategoryVisual", Order = 105)]
        public Brush AskBackColor { get; set; }
        [Browsable(false)]
        public string AskBackgroundBrushSerialize
        {
            get { return Gui.Serialize.BrushToString(AskBackColor, "brushAskPriceColumnBackground"); }
            set { AskBackColor = Gui.Serialize.StringToBrush(value, "brushAskPriceColumnBackground"); }
        }
        [XmlIgnore]
        [Display(ResourceType = typeof(Custom.Resource), Name = "NinjaScriptRecentColumnAskForeground", GroupName = "PropertyCategoryVisual", Order = 111)]
        public Brush AskForeColor { get; set; }
        [Browsable(false)]
        public string AskForeColorSerialize
        {
            get { return Gui.Serialize.BrushToString(AskForeColor); }
            set { AskForeColor = Gui.Serialize.StringToBrush(value); }
        }
        [XmlIgnore]
        [Display(ResourceType = typeof(Custom.Resource), Name = "NinjaScriptRecentColumnBidBackground", GroupName = "PropertyCategoryVisual", Order = 116)]
        public Brush BidBackColor { get; set; }
        [Browsable(false)]
        public string BidBackgroundBrushSerialize
        {
            get { return Gui.Serialize.BrushToString(BidBackColor, "brushBidPriceColumnBackground"); }
            set { BidBackColor = Gui.Serialize.StringToBrush(value, "brushBidPriceColumnBackground"); }
        }
        [XmlIgnore]
        [Display(ResourceType = typeof(Custom.Resource), Name = "NinjaScriptRecentColumnBidForeground", GroupName = "PropertyCategoryVisual", Order = 121)]
        public Brush BidForeColor { get; set; }
        [Browsable(false)]
        public string BidForeColorSerialize
        {
            get { return Gui.Serialize.BrushToString(BidForeColor); }
            set { BidForeColor = Gui.Serialize.StringToBrush(value); }
        }

        #endregion

        #endregion
        [TypeConverter("NinjaTrader.Custom.ResourceEnumConverter")]
        public enum PullingStackingDisplayType
        {
            Ask,
            Bid,
            BidAsk
        }
        [TypeConverter("NinjaTrader.Custom.ResourceEnumConverter")]
        public enum PullingStackingResetWhen
        {
            NoMoreData,
            BidAskChange
        }
    }
}
