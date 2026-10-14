#!/usr/bin/env python3
"""Compile/test the delivered source in isolated temporary projects.

Requires Python 3 and .NET SDK 10. Does NOT compile against NinjaTrader or WPF.
API-shaped stubs exercise integration/legacy parity; actual NT validation is separate.
Test fixtures use .txt extensions so they cannot become NinjaScript source by accident.
"""
from pathlib import Path
import argparse
import hashlib
import os
import shutil
import subprocess
import tempfile
import textwrap
from xml.sax.saxutils import escape

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path)
parser.add_argument('--log-dir', type=Path)
args = parser.parse_args()
fixtures = Path(__file__).resolve().parent
source = args.source
if source is None:
    for parent in (fixtures.parent, fixtures.parent.parent):
        candidate = parent / 'ExecutionOSPullingStacking_v3.cs'
        if candidate.is_file():
            source = candidate
            break
if source is None:
    parser.error('Specify --source /path/to/ExecutionOSPullingStacking_v3.cs')
source = source.resolve()
baseline = fixtures / 'baseline.cs.txt'
assert hashlib.sha256(baseline.read_bytes()).hexdigest() == 'a521f8c49dc62dcac8391d813ad5eb3399922764f7a42b4bfd69899dcc001298', 'Baseline fixture changed'
text = source.read_text()
core = text.split('#region v3 Rolling calculation core\n', 1)[1].rsplit('#endregion', 1)[0]
core = 'using System;\nusing System.Collections.Generic;\n' + textwrap.dedent(core)
dotnet = shutil.which('dotnet')
if not dotnet:
    parser.error('.NET SDK 10 dotnet executable was not found')
if args.log_dir:
    args.log_dir.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix='executionos-v3-tests-') as directory:
    root = Path(directory)
    env = dict(os.environ, DOTNET_CLI_HOME=str(root / 'dotnet-home'),
               NUGET_PACKAGES=str(root / 'nuget-packages'), DOTNET_CLI_TELEMETRY_OPTOUT='1',
               DOTNET_GENERATE_ASPNET_CERTIFICATE='false', DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1')
    for kind, files in (
        ('core', {'Program.cs': (fixtures / 'core-tests.cs.txt').read_text(), 'Core.cs': core}),
        ('adapter', {'Program.cs': (fixtures / 'adapter-tests.cs.txt').read_text(),
                     'ApiShapeStubs.cs': (fixtures / 'api-shape-stubs.cs.txt').read_text()})):
        project = root / kind
        project.mkdir()
        for name, contents in files.items():
            (project / name).write_text(contents)
        includes = ''.join('<Compile Include="' + escape(name, {'"': '&quot;'}) + '"/>' for name in files)
        if kind == 'adapter':
            includes += '<Compile Include="' + escape(str(source), {'"': '&quot;'}) + '" Link="V3.cs"/>'
            includes += '<Compile Include="' + escape(str(baseline), {'"': '&quot;'}) + '" Link="Original.cs"/>'
        (project / 'Tests.csproj').write_text(
            '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
            '<TargetFramework>net10.0</TargetFramework><LangVersion>5</LangVersion>'
            '<ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable>'
            '<EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup><ItemGroup>'
            + includes + '</ItemGroup></Project>')
        result = subprocess.run([dotnet, 'run', '--project', 'Tests.csproj', '-c', 'Release'],
                                cwd=project, env=env, text=True, capture_output=True)
        combined = result.stdout + result.stderr
        print(combined, end='')
        if args.log_dir:
            (args.log_dir / (kind + '-test-run.txt')).write_text(combined)
        if result.returncode:
            raise SystemExit(result.returncode)
print('All delivered-source harness tests passed. Actual NinjaTrader compilation/replay remains a separate check.')
