// ExecutionOS Depth Capture 0.1 EXP. Data-only diagnostic; no detector or orders.
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript.DrawingTools;
using NinjaTrader.NinjaScript.Indicators.ExecutionOSDepthCaptureV01;
namespace NinjaTrader.NinjaScript.Indicators
{
    public class ExecutionOSDepthCapture : Indicator
    {
        private CaptureSession capture;
        private Timer timer;
        private int pending;
        private volatile bool stopped = true;
        private long entry, depthOrdinal, l1Ordinal, lastMarker;
        private string lastMode, marker = "", startupError;
        private DateTime lastPlayback;
        private bool reported;
        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "ExecutionOSDepthCapture";
                Description = "Data-only 60-second native event recorder. No signals or trading authority.";
                Calculate = Calculate.OnEachTick; IsOverlay = true; IsSuspendedWhileInactive = false;
                DisplayInDataBox = false; PaintPriceMarkers = false;
                CaptureSeconds = 60; MaximumRecords = 250000; FeedLabel = "unspecified";
            }
            else if (State == State.Realtime)
            {
                try
                {
                    if(capture!=null)capture.Stop("realtime_reentered");
                    stopped = false; reported = false; entry = depthOrdinal = l1Ordinal = lastMarker = 0;
                    lastMode = null; lastPlayback = DateTime.MinValue; startupError = null;
                    string directory = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),"ExecutionOS","DepthCaptures");
                    capture = new CaptureSession(directory,new CaptureOptions { Seconds=CaptureSeconds,
                        MaxRecords=MaximumRecords, Instrument=Instrument.FullName, TickSize=TickSize,
                        FeedLabel=FeedLabel, HostTimeZone=TimeZoneInfo.Local.Id });
                    CaptureRow r = Stamp("context",0); r.Context = "Realtime recorder attached; earlier history not captured"; capture.Append(r);
                    Print("ECLCAP|START|" + capture.Status().Path);
                }
                catch(Exception ex) { startupError=ex.GetType().Name+": "+ex.Message; }
                timer = new Timer(Pulse,null,100,250);
            }
            else if (State == State.Terminated)
            {
                stopped = true; if(timer!=null){timer.Dispose();timer=null;}
                if(capture!=null)capture.Stop("indicator_removed"); // Worker drains asynchronously.
            }
        }
        private CaptureRow Stamp(string kind,long ordinal)
        {
            long id=Interlocked.Increment(ref entry); long receipt=System.Diagnostics.Stopwatch.GetTimestamp();
            DateTime utc=DateTime.UtcNow; var playback=Connection.PlaybackConnection;
            return new CaptureRow { Kind=kind, Entry=id, Ordinal=ordinal, Receipt=receipt, Utc=utc,
                Instrument=Instrument.FullName, Mode=playback==null?"Live":"Playback",
                Playback=playback==null?DateTime.MinValue:playback.Now, Position=-1,
                Price=double.NaN, Bid=double.NaN, Ask=double.NaN };
        }
        private bool Eligible(Instrument source,bool reset)
        { return !stopped && capture!=null && capture.Accepting && State==State.Realtime && (reset || source!=null && source.FullName==Instrument.FullName); }
        protected override void OnMarketDepth(MarketDepthEventArgs e)
        {
            if(!Eligible(e.Instrument,e.IsReset))return;
            CaptureRow r=Stamp("depth",Interlocked.Increment(ref depthOrdinal));
            r.Instrument=e.Instrument==null?Instrument.FullName:e.Instrument.FullName;
            r.DataType=e.MarketDataType.ToString();r.Operation=e.Operation.ToString();r.Position=e.Position;
            r.Price=e.Price;r.Volume=e.Volume;r.MarketMaker=e.MarketMaker;r.Source=e.Time;r.IsReset=e.IsReset;
            capture.Append(r); // Copies values; no provider event or snapshot is retained.
        }
        protected override void OnMarketData(MarketDataEventArgs e)
        {
            if(!Eligible(e.Instrument,e.IsReset))return;
            CaptureRow r=Stamp("marketdata",Interlocked.Increment(ref l1Ordinal));
            r.Instrument=e.Instrument==null?Instrument.FullName:e.Instrument.FullName;
            r.DataType=e.MarketDataType.ToString();r.Price=e.Price;r.Volume=e.Volume;
            r.Bid=e.Bid;r.Ask=e.Ask;r.Source=e.Time;r.IsReset=e.IsReset;capture.Append(r);
        }
        protected override void OnConnectionStatusUpdate(ConnectionStatusEventArgs e)
        {
            if(stopped || capture==null || State!=State.Realtime)return;
            CaptureRow r=Stamp("context",0);
            r.Context="price_connection_notification; name="+(e.Connection==null||e.Connection.Options==null?"unavailable":e.Connection.Options.Name)
                +"; previous_price_status="+e.PreviousPriceStatus+"; price_status="+e.PriceStatus
                +"; scope=notification observed by indicator, not verified active-feed mapping";
            capture.Append(r);
        }
        protected override void OnBarUpdate() { }
        private void Pulse(object ignored)
        {
            if(stopped || Interlocked.CompareExchange(ref pending,1,0)!=0)return;
            try { TriggerCustomEvent(delegate(object state) {
                try
                {
                    if(stopped)return;
                    if(capture==null){Draw.TextFixed(this,"ECLCAP","Depth Capture could not start: "+startupError,TextPosition.TopLeft);return;}
                    CaptureStatus status=capture.Status();
                    if(status.Accepting)
                    {
                        CaptureRow r=Stamp("marker",0);
                        if(lastMode!=null && r.Mode!=lastMode){CaptureRow c=r;c.Kind="context";c.Context="live_playback_mode_changed";capture.Append(c);}
                        if(r.Mode=="Playback" && lastPlayback!=DateTime.MinValue && r.Playback<lastPlayback){CaptureRow c=r;c.Kind="context";c.Context="playback_clock_rewind";capture.Append(c);}
                        lastMode=r.Mode;lastPlayback=r.Playback;
                        if(lastMarker==0 || r.Receipt-lastMarker>=System.Diagnostics.Stopwatch.Frequency)
                        {
                            lastMarker=r.Receipt;r.Context="UI checkpoint marker; not a depth observation";
                            if(capture.Append(r))marker="Checkpoint UTC "+r.Utc.ToString("HH:mm:ss.fff",CultureInfo.InvariantCulture)+" | entry "+r.Entry;
                        }
                    }
                    status=capture.Status();
                    string stateText=status.Done?(status.Complete?"CAPTURE SAVED — native validation pending":"CAPTURE INCOMPLETE — "+status.Reason):status.Accepting?"RECORDING":"SAVING";
                    Draw.TextFixed(this,"ECLCAP","ExecutionOS Depth Capture 0.1 EXP | DATA ONLY\n"+stateText
                        +" | "+Math.Min(status.Elapsed,CaptureSeconds).ToString("F1",CultureInfo.InvariantCulture)+" / "+CaptureSeconds+" wall seconds"
                        +"\nDepth "+status.Depth+" | Trades "+status.Last+" | Quotes "+status.Quotes
                        +" | Serialized "+status.Written+" / accepted "+status.Accepted+" | Dropped "+status.Dropped+" | Persistence unknown "+status.PersistenceUnknown
                        +"\n"+marker+"\n"+status.Path+(status.Error==null?"":"\n"+status.Error),TextPosition.TopLeft);
                    if(status.Done && !reported){reported=true;Print("ECLCAP|"+(status.Complete?"SAVED":"INCOMPLETE")+"|"+status.Reason+"|dropped="+status.Dropped+"|"+status.Path+(status.Error==null?"":"|"+status.Error));}
                }
                finally {Interlocked.Exchange(ref pending,0);}
            },null); }
            catch {Interlocked.Exchange(ref pending,0);}
        }
        [NinjaScriptProperty,Range(10,120),Display(Name="Capture seconds",GroupName="Capture",Order=1)]
        public int CaptureSeconds{get;set;}
        [NinjaScriptProperty,Range(1000,1000000),Display(Name="Maximum records",GroupName="Capture",Order=2)]
        public int MaximumRecords{get;set;}
        [NinjaScriptProperty,Display(Name="Feed label (optional)",GroupName="Capture",Order=3)]
        public string FeedLabel{get;set;}
    }
}

namespace NinjaTrader.NinjaScript.Indicators.ExecutionOSDepthCaptureV01
{
    internal struct CaptureRow
    {
        internal long Sequence, Entry, Ordinal, Receipt, Admission;
        internal DateTime Utc, Source, Playback;
        internal string Kind, Instrument, DataType, Operation, MarketMaker, Mode, Context;
        internal int Position;
        internal double Price, Bid, Ask;
        internal long Volume;
        internal bool IsReset;
    }
    internal sealed class CaptureOptions
    {
        internal double Seconds = 60;
        internal int MaxRecords = 250000, MaxPending = 32768;
        internal long MaxBytes = 128L * 1024 * 1024;
        internal string Instrument, FeedLabel = "unspecified", HostTimeZone;
        internal double TickSize;
    }
    internal sealed class CaptureStatus
    {
        internal bool Accepting, Done, Complete;
        internal string Reason, Error, Path;
        internal long Accepted, Written, Dropped, Depth, Last, Quotes, Pending, PeakPending, PersistenceUnknown;
        internal double Elapsed;
    }
    internal sealed class CaptureSession
    {
        private readonly object gate = new object();
        private readonly Queue<CaptureRow> queue = new Queue<CaptureRow>();
        private readonly System.Threading.AutoResetEvent ready = new System.Threading.AutoResetEvent(false);
        internal readonly System.Threading.ManualResetEvent Finished = new System.Threading.ManualResetEvent(false);
        private readonly CaptureOptions options;
        private readonly string partialPath, finalPath;
        private readonly long started, deadline;
        private readonly DateTime startedUtc;
        private readonly System.Threading.Thread worker;
        private readonly Func<string, System.IO.Stream> open;
        private volatile bool stopping;
        private bool done;
        internal bool Accepting { get { return !stopping; } }
        private string reason, error;
        private long accepted, written, rejected, dataDepth, dataLast, dataQuotes, peak, bytes, stoppedCounter;
        private DateTime stoppedUtc;
        private CaptureRow? firstRejected;
        private readonly System.Text.UTF8Encoding utf8 = new System.Text.UTF8Encoding(false, true);
        private const long FooterReserve = 4096;
        internal CaptureSession(string directory, CaptureOptions settings, bool autoStart = true,
            Func<string, System.IO.Stream> streamFactory = null)
        {
            if (settings.Seconds <= 0 || settings.MaxRecords < 1 || settings.MaxPending < 1 || settings.MaxBytes < 8192)
                throw new ArgumentOutOfRangeException("Capture limits");
            options = new CaptureOptions { Seconds=settings.Seconds, MaxRecords=settings.MaxRecords, MaxPending=settings.MaxPending, MaxBytes=settings.MaxBytes, Instrument=settings.Instrument, FeedLabel=settings.FeedLabel, HostTimeZone=settings.HostTimeZone, TickSize=settings.TickSize }; startedUtc = DateTime.UtcNow; started = System.Diagnostics.Stopwatch.GetTimestamp();
            deadline = started + (long)(options.Seconds * System.Diagnostics.Stopwatch.Frequency);
            string symbol = Safe(options.Instrument);
            string run = "DepthCapture_" + startedUtc.ToString("yyyyMMdd_HHmmss_fff", CultureInfo.InvariantCulture)
                + "_" + symbol + "_" + Guid.NewGuid().ToString("N").Substring(0,8);
            finalPath = System.IO.Path.Combine(directory, run + ".jsonl"); partialPath = finalPath + ".partial";
            open = streamFactory ?? delegate(string path) {
                System.IO.Directory.CreateDirectory(directory);
                return new System.IO.FileStream(path, System.IO.FileMode.CreateNew, System.IO.FileAccess.Write, System.IO.FileShare.Read);
            };
            worker = new System.Threading.Thread(Run); worker.IsBackground = true;
            worker.Name = "ExecutionOS bounded depth recorder";
            if (autoStart) worker.Start();
        }
        internal void Start() { worker.Start(); }
        private static string Safe(string s)
        {
            StringBuilder b = new StringBuilder();
            foreach (char c in s ?? "instrument") if (char.IsLetterOrDigit(c) || c == '-' || c == '_') b.Append(c); else b.Append('_');
            return b.Length == 0 ? "instrument" : b.ToString();
        }
        internal static string J(string s)
        {
            StringBuilder b = new StringBuilder("\"");
            foreach (char c in s ?? "")
                if (c == '\\' || c == '"') b.Append('\\').Append(c);
                else if (c < 32 || char.IsSurrogate(c)) b.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else b.Append(c);
            return b.Append('"').ToString();
        }
        private static string N(double n)
        { return double.IsNaN(n) || double.IsInfinity(n) ? "null" : n.ToString("R", CultureInfo.InvariantCulture); }
        private static string I(long n) { return n.ToString(CultureInfo.InvariantCulture); }
        private void StopLocked(string why) { if (!stopping) { stopping = true; reason = why; stoppedCounter = System.Diagnostics.Stopwatch.GetTimestamp(); stoppedUtc = DateTime.UtcNow; } }
        internal bool Append(CaptureRow row)
        {
            lock (gate)
            {
                if (stopping) return false;
                if (System.Diagnostics.Stopwatch.GetTimestamp() >= deadline) { StopLocked("duration"); ready.Set(); return false; }
                if (accepted >= options.MaxRecords) { rejected++; firstRejected=row; StopLocked("record_limit"); ready.Set(); return false; }
                if (queue.Count >= options.MaxPending) { rejected++; firstRejected=row; StopLocked("queue_overflow"); ready.Set(); return false; }
                row.Sequence = ++accepted; row.Admission = System.Diagnostics.Stopwatch.GetTimestamp(); queue.Enqueue(row);
                if (row.Kind == "depth") dataDepth++;
                if (row.Kind == "marketdata" && row.DataType == "Last") dataLast++;
                if (row.Kind == "marketdata" && (row.DataType == "Bid" || row.DataType == "Ask")) dataQuotes++;
                if (queue.Count > peak) peak = queue.Count;
                ready.Set(); return true;
            }
        }
        internal void Stop(string why) { lock (gate) { if (!stopping) { StopLocked(why); ready.Set(); } } }
        internal CaptureStatus Status()
        {
            lock (gate) return new CaptureStatus { Accepting = !stopping, Done = done,
                Complete = done && reason == "duration" && error == null && rejected == 0 && accepted == written,
                Reason = reason, Error = error, Path = done && error == null ? finalPath : partialPath,
                Accepted = accepted, Written = written, Dropped = rejected + (done ? accepted-written : 0),
                Depth = dataDepth, Last = dataLast, Quotes = dataQuotes, Pending = queue.Count, PeakPending = peak, PersistenceUnknown = error == null ? 0 : accepted,
                Elapsed = (System.Diagnostics.Stopwatch.GetTimestamp()-started)/(double)System.Diagnostics.Stopwatch.Frequency };
        }
        internal static string Serialize(CaptureRow r)
        {
            return "{\"type\":" + J(r.Kind) + ",\"seq\":" + I(r.Sequence) + ",\"entry_seq\":" + I(r.Entry)
                + ",\"stream_ordinal\":" + I(r.Ordinal) + ",\"instrument\":" + J(r.Instrument)
                + ",\"data_type\":" + J(r.DataType) + ",\"operation\":" + J(r.Operation) + ",\"position\":" + r.Position
                + ",\"price\":" + N(r.Price) + ",\"price_raw\":" + J(r.Price.ToString("R",CultureInfo.InvariantCulture))
                + ",\"volume\":" + I(r.Volume) + ",\"bid\":" + N(r.Bid) + ",\"ask\":" + N(r.Ask)
                + ",\"bid_raw\":" + J(r.Bid.ToString("R",CultureInfo.InvariantCulture)) + ",\"ask_raw\":" + J(r.Ask.ToString("R",CultureInfo.InvariantCulture))
                + ",\"market_maker\":" + J(r.MarketMaker) + ",\"is_reset\":" + (r.IsReset?"true":"false")
                + ",\"source_time\":" + J(r.Source.ToString("o",CultureInfo.InvariantCulture)) + ",\"source_kind\":" + J(r.Source.Kind.ToString())
                + ",\"receipt_utc\":" + J(r.Utc.ToString("o",CultureInfo.InvariantCulture)) + ",\"receipt_counter\":" + I(r.Receipt)
                + ",\"admission_counter\":" + I(r.Admission) + ",\"mode\":" + J(r.Mode) + ",\"playback_clock\":" + J(r.Playback.ToString("o",CultureInfo.InvariantCulture))
                + ",\"context\":" + J(r.Context) + "}";
        }
        private string Header()
        {
            return "{\"type\":\"start\",\"schema\":\"executionos.depth-capture.v0.1\",\"build\":\"0.1 EXP 2026-10-22\",\"seq\":0"
                + ",\"instrument\":" + J(options.Instrument) + ",\"tick_size\":" + N(options.TickSize)
                + ",\"feed_label\":" + J(options.FeedLabel) + ",\"feed_label_provenance\":\"user setting, not verified routing identity\""
                + ",\"started_utc\":" + J(startedUtc.ToString("o",CultureInfo.InvariantCulture)) + ",\"started_counter\":" + I(started)
                + ",\"deadline_counter\":" + I(deadline) + ",\"counter_frequency\":" + I(System.Diagnostics.Stopwatch.Frequency) + ",\"host_timezone\":" + J(options.HostTimeZone)
                + ",\"source_timezone\":\"unspecified API source; preserve raw value and Kind\",\"requested_wall_seconds\":" + N(options.Seconds)
                + ",\"max_records\":" + options.MaxRecords + ",\"max_pending\":" + options.MaxPending + ",\"max_bytes\":" + I(options.MaxBytes)
                + ",\"ordering\":\"seq is local admission order; entry_seq and stream_ordinal mark callback entry; not exchange global order\""
                + ",\"completion_policy\":\"require finalized .jsonl filename and end record; .partial is incomplete\",\"execution_enabled\":false}";
        }
        private string Footer()
        {
            lock (gate) return "{\"type\":\"end\",\"seq\":" + I(accepted+1) + ",\"stop_reason\":" + J(reason)
                + ",\"accepted_records\":" + I(accepted) + ",\"written_records\":" + I(written)
                + ",\"dropped_records\":" + I(rejected + accepted-written) + ",\"depth_records\":" + I(dataDepth)
                + ",\"last_records\":" + I(dataLast) + ",\"quote_records\":" + I(dataQuotes) + ",\"peak_pending\":" + I(peak)
                + ",\"capture_complete\":" + (reason=="duration" && rejected==0 && accepted==written ? "true":"false")
                + ",\"native_intake_validation\":\"NOT_ESTABLISHED\",\"native_dom_checkpoints\":\"EXTERNAL_REQUIRED\""
                + ",\"stopped_utc\":" + J(stoppedUtc.ToString("o",CultureInfo.InvariantCulture)) + ",\"stopped_counter\":" + I(stoppedCounter)
                + ",\"end_written_utc\":" + J(DateTime.UtcNow.ToString("o",CultureInfo.InvariantCulture))
                + ",\"first_rejected\":" + (firstRejected.HasValue ? "{\"entry_seq\":"+I(firstRejected.Value.Entry)+",\"kind\":"+J(firstRejected.Value.Kind)+",\"position\":"+firstRejected.Value.Position+",\"price_raw\":"+J(firstRejected.Value.Price.ToString("R",CultureInfo.InvariantCulture))+"}" : "null") + "}";
        }
        private void Run()
        {
            try
            {
                using (System.IO.Stream stream = open(partialPath))
                using (System.IO.StreamWriter writer = new System.IO.StreamWriter(stream,utf8,65536))
                {
                    writer.NewLine = "\n"; string header = Header(); writer.WriteLine(header); bytes = utf8.GetByteCount(header)+1;
                    while (true)
                    {
                        CaptureRow row = new CaptureRow(); bool have = false, finish = false;
                        lock (gate)
                        {
                            if (!stopping && System.Diagnostics.Stopwatch.GetTimestamp() >= deadline) StopLocked("duration");
                            if (queue.Count > 0) { row = queue.Dequeue(); have = true; }
                            else finish = stopping;
                        }
                        if (finish) break;
                        if (!have) { ready.WaitOne(25); continue; }
                        string line = Serialize(row); long size = utf8.GetByteCount(line)+1;
                        if (bytes + size > options.MaxBytes-FooterReserve)
                        { lock (gate) { StopLocked("byte_limit"); reason = "byte_limit"; firstRejected=row; queue.Clear(); } break; }
                        writer.WriteLine(line); bytes += size;
                        lock (gate) written++;
                    }
                    writer.WriteLine(Footer()); writer.Flush();
                    System.IO.FileStream file = stream as System.IO.FileStream;
                    if (file != null) file.Flush(true);
                }
                System.IO.File.Move(partialPath,finalPath);
            }
            catch (Exception ex)
            {
                lock (gate) { StopLocked("io_error"); reason = "io_error"; error = ex.GetType().Name + ": " + ex.Message; queue.Clear(); }
            }
            finally { lock (gate) { stopping = true; done = true; } Finished.Set(); }
        }
    }
}


#region NinjaScript generated code. Neither change nor remove.

namespace NinjaTrader.NinjaScript.Indicators
{
	public partial class Indicator : NinjaTrader.Gui.NinjaScript.IndicatorRenderBase
	{
		private ExecutionOSDepthCapture[] cacheExecutionOSDepthCapture;
		public ExecutionOSDepthCapture ExecutionOSDepthCapture(int captureSeconds, int maximumRecords, string feedLabel)
		{
			return ExecutionOSDepthCapture(Input, captureSeconds, maximumRecords, feedLabel);
		}

		public ExecutionOSDepthCapture ExecutionOSDepthCapture(ISeries<double> input, int captureSeconds, int maximumRecords, string feedLabel)
		{
			if (cacheExecutionOSDepthCapture != null)
				for (int idx = 0; idx < cacheExecutionOSDepthCapture.Length; idx++)
					if (cacheExecutionOSDepthCapture[idx] != null && cacheExecutionOSDepthCapture[idx].CaptureSeconds == captureSeconds && cacheExecutionOSDepthCapture[idx].MaximumRecords == maximumRecords && cacheExecutionOSDepthCapture[idx].FeedLabel == feedLabel && cacheExecutionOSDepthCapture[idx].EqualsInput(input))
						return cacheExecutionOSDepthCapture[idx];
			return CacheIndicator<ExecutionOSDepthCapture>(new ExecutionOSDepthCapture(){ CaptureSeconds = captureSeconds, MaximumRecords = maximumRecords, FeedLabel = feedLabel }, input, ref cacheExecutionOSDepthCapture);
		}
	}
}

namespace NinjaTrader.NinjaScript.MarketAnalyzerColumns
{
	public partial class MarketAnalyzerColumn : MarketAnalyzerColumnBase
	{
		public Indicators.ExecutionOSDepthCapture ExecutionOSDepthCapture(int captureSeconds, int maximumRecords, string feedLabel)
		{
			return indicator.ExecutionOSDepthCapture(Input, captureSeconds, maximumRecords, feedLabel);
		}

		public Indicators.ExecutionOSDepthCapture ExecutionOSDepthCapture(ISeries<double> input , int captureSeconds, int maximumRecords, string feedLabel)
		{
			return indicator.ExecutionOSDepthCapture(input, captureSeconds, maximumRecords, feedLabel);
		}
	}
}

namespace NinjaTrader.NinjaScript.Strategies
{
	public partial class Strategy : NinjaTrader.Gui.NinjaScript.StrategyRenderBase
	{
		public Indicators.ExecutionOSDepthCapture ExecutionOSDepthCapture(int captureSeconds, int maximumRecords, string feedLabel)
		{
			return indicator.ExecutionOSDepthCapture(Input, captureSeconds, maximumRecords, feedLabel);
		}

		public Indicators.ExecutionOSDepthCapture ExecutionOSDepthCapture(ISeries<double> input , int captureSeconds, int maximumRecords, string feedLabel)
		{
			return indicator.ExecutionOSDepthCapture(input, captureSeconds, maximumRecords, feedLabel);
		}
	}
}

#endregion
