#!/usr/bin/env python3
"""Publication checks for the unchanged, data-only recorder. Python 3 + .NET 10.

Extracts the exact pure CaptureSession classes; no NinjaTrader/WPF is invoked.
The cutoff case characterizes a limitation, not exchange-completeness acceptance.
"""
from pathlib import Path
import hashlib, json, os, subprocess, tempfile

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent.parent / 'ExecutionOSDepthCapture.cs'
EXPECTED = '5b9d787c7a8b4afffbd537ffdea5db995b38554680d402eca57afcf9493cc4f7'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == EXPECTED, 'Source checkpoint hash differs'
s = SOURCE.read_text()
core = s[s.index('    internal struct CaptureRow'):s.index('#region NinjaScript generated code.')]
prefix = 'using System;\nusing System.Collections.Generic;\nusing System.Globalization;\nusing System.Text;\nnamespace RecorderTests {\n'
program = r'''
using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Text.Json;
namespace RecorderTests {
class FailFlush : FileStream {
 public FailFlush(string path):base(path,FileMode.CreateNew,FileAccess.Write,FileShare.Read){}
 public override void Flush(){throw new IOException("Injected flush failure");}
}
class Program {
 static int tests;
 static void Check(bool ok,string name){if(!ok)throw new Exception(name);tests++;Console.WriteLine("PASS "+name);}
 static CaptureOptions Options(){return new CaptureOptions {Seconds=10,Instrument="ES DEC26",TickSize=.25};}
 static CaptureRow Row(long id){return new CaptureRow {Kind="depth",Entry=id,Ordinal=id,Receipt=id,Instrument="ES DEC26",DataType="Bid",Operation="Add",Position=0,Price=100,Volume=1};}
 static JsonDocument End(CaptureSession c){if(!c.Finished.WaitOne(5000))throw new Exception("Worker timeout");return JsonDocument.Parse(File.ReadAllLines(c.Status().Path).Last());}
 static bool Complete(JsonDocument d){return d.RootElement.GetProperty("capture_complete").GetBoolean();}
 static long Number(JsonDocument d,string n){return d.RootElement.GetProperty(n).GetInt64();}
 static string Folder(){string p=Path.Combine(Path.GetTempPath(),"recorder-check-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(p);return p;}
 static void Main(){
  {
   var o=Options();o.Seconds=.08;var c=new CaptureSession(Folder(),o,false);c.Append(Row(1));c.Append(Row(2));c.Start();
   using(var d=End(c))Check(Complete(d)&&Number(d,"accepted_records")==2&&Number(d,"written_records")==2&&Number(d,"dropped_records")==0&&c.Status().Path.EndsWith(".jsonl")&&!File.Exists(c.Status().Path+".partial"),"duration drains, flushes and finalizes admitted rows");
  }
  {
   var o=Options();o.MaxRecords=2;var c=new CaptureSession(Folder(),o,false);c.Append(Row(1));c.Append(Row(2));bool admitted=c.Append(Row(3));c.Start();
   using(var d=End(c))Check(!admitted&&!Complete(d)&&Number(d,"accepted_records")==2&&Number(d,"written_records")==2&&Number(d,"dropped_records")==1&&d.RootElement.GetProperty("stop_reason").GetString()=="record_limit","record limit is incomplete and counts rejection");
  }
  {
   var o=Options();o.MaxPending=1;var c=new CaptureSession(Folder(),o,false);c.Append(Row(1));bool admitted=c.Append(Row(2));c.Start();
   using(var d=End(c))Check(!admitted&&!Complete(d)&&Number(d,"dropped_records")==1&&d.RootElement.GetProperty("stop_reason").GetString()=="queue_overflow","queue overflow is incomplete and counts rejection");
  }
  {
   var o=Options();o.MaxBytes=8192;var c=new CaptureSession(Folder(),o,false);var r=Row(1);r.Context=new string('x',7000);c.Append(r);c.Start();
   using(var d=End(c))Check(!Complete(d)&&Number(d,"accepted_records")==1&&Number(d,"written_records")==0&&Number(d,"dropped_records")==1&&d.RootElement.GetProperty("stop_reason").GetString()=="byte_limit"&&new FileInfo(c.Status().Path).Length<=8192,"byte limit accounts for admitted but unwritten row");
  }
  {
   var c=new CaptureSession(Folder(),Options(),false,delegate(string p){return new FailFlush(p);});c.Append(Row(1));c.Stop("duration");c.Start();
   if(!c.Finished.WaitOne(5000))throw new Exception("Worker timeout");var st=c.Status();
   Check(!st.Complete&&st.Error!=null&&st.PersistenceUnknown==1&&st.Path.EndsWith(".partial")&&File.Exists(st.Path)&&!File.Exists(st.Path.Substring(0,st.Path.Length-8)),"flush failure preserves partial and persistence uncertainty");
  }
  {
   var c=new CaptureSession(Folder(),Options(),false);c.Append(Row(2));c.Append(Row(1));c.Stop("indicator_removed");c.Start();
   using(var d=End(c)){string[] rows=File.ReadAllLines(c.Status().Path);using(var a=JsonDocument.Parse(rows[1]))using(var b=JsonDocument.Parse(rows[2]))Check(a.RootElement.GetProperty("seq").GetInt64()==1&&a.RootElement.GetProperty("entry_seq").GetInt64()==2&&b.RootElement.GetProperty("seq").GetInt64()==2&&b.RootElement.GetProperty("entry_seq").GetInt64()==1,"admission order preserves entry-order inversion");}
  }
  {
   var o=Options();o.Seconds=.001;var c=new CaptureSession(Folder(),o,false);var early=Row(1);Thread.Sleep(20);bool admitted=c.Append(early);c.Start();
   using(var d=End(c))Check(!admitted&&Complete(d)&&Number(d,"accepted_records")==0&&Number(d,"dropped_records")==0,"CONTRACT: deadline-excluded row is outside drop counter");
  }
  {
   var o=Options();o.MaxBytes=8192;o.FeedLabel=new string('x',10000);var c=new CaptureSession(Folder(),o,false);c.Stop("duration");c.Start();
   using(var d=End(c))Check(Complete(d)&&new FileInfo(c.Status().Path).Length>8192,"EXPECTED DEFECT: oversized header bypasses byte cap");
  }
  Console.WriteLine("RESULT "+tests+" publication checks reproduced; native integration untested");
 }
}}
'''
with tempfile.TemporaryDirectory(prefix='depth-capture-publication-') as td:
    p = Path(td)
    (p/'Core.cs').write_text(prefix+core)
    (p/'Program.cs').write_text(program)
    (p/'Checks.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><LangVersion>5</LangVersion><WarningLevel>0</WarningLevel></PropertyGroup></Project>')
    env = dict(os.environ, DOTNET_CLI_HOME=str(p/'cli'), DOTNET_CLI_TELEMETRY_OPTOUT='1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1')
    r = subprocess.run(['dotnet','run','--project',str(p/'Checks.csproj'),'-c','Release'],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    print(r.stdout)
    if r.returncode:raise SystemExit(r.returncode)
    assert 'RESULT 8 publication checks reproduced' in r.stdout
