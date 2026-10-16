#!/usr/bin/env python3
"""Reproduce experimental v4 checks. Uses C# 5/API-shaped stubs, not NinjaTrader assemblies."""
from pathlib import Path
import os,argparse,tempfile,subprocess,hashlib,textwrap,shutil
from xml.sax.saxutils import escape
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path);p.add_argument('--log-dir',type=Path);p.add_argument('--only',choices=['rolling','compatibility','flow','flow-integration','repair','repair-integration','readiness','readiness-integration','diagnostics','diagnostics-integration','history-integration','summary-integration']);a=p.parse_args()
f=Path(__file__).resolve().parent;s=(a.source or f.parent/'ExecutionOSPullingStacking_v4_Experimental.cs').resolve();text=s.read_text()
assert hashlib.sha256((f/'baseline.cs.txt').read_bytes()).hexdigest()=='a521f8c49dc62dcac8391d813ad5eb3399922764f7a42b4bfd69899dcc001298'
assert hashlib.sha256((f/'v3-baseline.cs.txt').read_bytes()).hexdigest()=='6d6d7770feeb9442a01984cec190782683a5c106b078c6d88c193e7c4c655902'
assert hashlib.sha256((f/'v4-previous.cs.txt').read_bytes()).hexdigest()=='f313f77273c070a3923803213bc42c10da8008392b10c5abb0976d266d2f44ff'
previous_text=(f/'v4-previous.cs.txt').read_text()
previous_core='using System;\nusing System.Collections.Generic;\n'+textwrap.dedent(previous_text.split('#region v4 Flow evidence core\n',1)[1].split('#endregion',1)[0]).replace('ExecutionOSFlowEvidenceV4','ExecutionOSFlowEvidencePrevious')
assert previous_core==(f/'flow-previous.cs.txt').read_text()
previous_column=previous_text
for before,after in [('ExecutionOSPullingStacking_v4_Experimental','ExecutionOSPullingStacking_v4_Experimental_Previous'),('ExecutionOSPullingStackingCalculationModeV4','ExecutionOSPullingStackingCalculationModePrevious'),('ExecutionOSRollingLiquidityV4','ExecutionOSRollingLiquidityPrevious'),('ExecutionOSFlowEvidenceV4','ExecutionOSFlowEvidencePreviousAdapter')]:previous_column=previous_column.replace(before,after)
assert previous_column==(f/'column-previous.cs.txt').read_text()
def core(name):
 raw=text.split('#region '+name+'\n',1)[1].split('#endregion',1)[0]
 return 'using System;\nusing System.Collections.Generic;\n'+textwrap.dedent(raw)
if a.log_dir:a.log_dir.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='executionos-v4-tests-') as td:
 root=Path(td);frozen=root/'Source.cs';frozen.write_bytes(s.read_bytes());env=dict(os.environ,DOTNET_CLI_HOME=str(root/'dotnet-home'),NUGET_PACKAGES=str(root/'nuget-packages'),DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_GENERATE_ASPNET_CERTIFICATE='false')
 groups=[('rolling',{'Program.cs':(f/'core-tests.cs.txt').read_text(),'Core.cs':core('v4 Rolling calculation core')},[],'Program'),
 ('compatibility',{'Program.cs':(f/'adapter-tests.cs.txt').read_text(),'Stubs.cs':(f/'api-shape-stubs.cs.txt').read_text()},[frozen,f/'baseline.cs.txt',f/'v3-baseline.cs.txt'],'Program')]
 if (f/'flow-tests.cs.txt').exists():groups.append(('flow',{'Program.cs':(f/'flow-tests.cs.txt').read_text(),'Flow.cs':core('v4 Flow evidence core')},[],'Program'))
 if (f/'flow-adapter-tests.cs.txt').exists():groups.append(('flow-integration',{'Program.cs':(f/'flow-adapter-tests.cs.txt').read_text(),'Stubs.cs':(f/'api-shape-stubs.cs.txt').read_text()},[frozen],'Program'))
 if (f/'repair-tests.cs.txt').exists():groups.append(('repair',{'Program.cs':(f/'repair-tests.cs.txt').read_text(),'Flow.cs':core('v4 Flow evidence core')},[],'Program'))
 if (f/'repair-adapter-tests.cs.txt').exists():groups.append(('repair-integration',{'Program.cs':(f/'repair-adapter-tests.cs.txt').read_text(),'Stubs.cs':(f/'api-shape-stubs.cs.txt').read_text()},[frozen],'Program'))
 if (f/'readiness-tests.cs.txt').exists():groups.append(('readiness',{'Program.cs':(f/'readiness-tests.cs.txt').read_text(),'Flow.cs':core('v4 Flow evidence core')},[],'Program'))
 if (f/'readiness-adapter-tests.cs.txt').exists():groups.append(('readiness-integration',{'Program.cs':(f/'readiness-adapter-tests.cs.txt').read_text(),'Stubs.cs':(f/'api-shape-stubs.cs.txt').read_text()},[frozen],'Program'))
 if (f/'diagnostics-tests.cs.txt').exists():groups.append(('diagnostics',{'Program.cs':(f/'diagnostics-tests.cs.txt').read_text(),'Flow.cs':core('v4 Flow evidence core'),'PreviousFlow.cs':(f/'flow-previous.cs.txt').read_text()},[],'Program'))
 if (f/'diagnostics-adapter-tests.cs.txt').exists():groups.append(('diagnostics-integration',{'Program.cs':(f/'diagnostics-adapter-tests.cs.txt').read_text(),'Stubs.cs':(f/'api-shape-stubs.cs.txt').read_text(),'PreviousColumn.cs':(f/'column-previous.cs.txt').read_text()},[frozen],'Program'))
 if (f/'history-adapter-tests.cs.txt').exists():groups.append(('history-integration',{'Program.cs':(f/'history-adapter-tests.cs.txt').read_text(),'Stubs.cs':(f/'api-shape-stubs.cs.txt').read_text()},[frozen],'Program'))
 if (f/'summary-adapter-tests.cs.txt').exists():groups.append(('summary-integration',{'Program.cs':(f/'summary-adapter-tests.cs.txt').read_text(),'Stubs.cs':(f/'api-shape-stubs.cs.txt').read_text()},[frozen],'Program'))
 for kind,files,refs,startup in groups:
  if a.only and a.only != kind:continue
  d=root/kind;d.mkdir()
  for name,value in files.items():(d/name).write_text(value)
  includes=''.join('<Compile Include="'+escape(str(name),{'"':'&quot;'})+'"/>' for name in list(files)+refs)
  (d/'Tests.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><LangVersion>5</LangVersion><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable><EnableDefaultCompileItems>false</EnableDefaultCompileItems><StartupObject>'+startup+'</StartupObject></PropertyGroup><ItemGroup>'+includes+'</ItemGroup></Project>')
  run=subprocess.run([shutil.which('dotnet') or '/usr/local/share/dotnet/dotnet','run','--project','Tests.csproj','-c','Release'],cwd=d,env=env,capture_output=True,text=True)
  output=run.stdout+run.stderr;print(output,end='')
  if a.log_dir:(a.log_dir/(kind+'-test-run.txt')).write_text(output)
  if run.returncode:raise SystemExit(run.returncode)
print('Experimental source harness passed. Actual NT compilation, visual QA and labelled Level II replay still required.')
