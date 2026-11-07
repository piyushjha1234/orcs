<#
Orcs installer (Windows / PowerShell) — mirrors install.sh.

Sets up the Orcs Harness:
  * installs 6 official community skills GLOBALLY (user level)
  * removes the legacy home-grown Orcs skills
  * installs the Orcs agents + the orcs-pipeline (harness contract) skill
  * installs the harness kit (gates, contracts, knowledge) -> <target>\orcs
  * registers the stage-advance hook (PreToolUse, Agent|Task) in <target>\settings.json
  * appends the global CLAUDE.md enforcement block (caveman + task-observer)

Usage (from inside a clone of the Orcs repo):
  powershell -ExecutionPolicy Bypass -File .\install.ps1
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Project C:\path\to\project
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -SkipSkills
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Help

Requirements: Git for Windows (provides bash) and jq always — the harness gates are bash
scripts; Node >= 22.20, npx, and the `claude` CLI for the skills.
#>

[CmdletBinding()]
param(
  [string]$Project,
  [switch]$SkipSkills,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
  Get-Content $PSCommandPath | Select-Object -First 20 | Where-Object { $_ -notmatch '^<#|^#>' } | ForEach-Object { $_ }
  exit 0
}

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcAgents  = Join-Path $ScriptDir 'agents'
$SrcSkills  = Join-Path $ScriptDir 'skills'

$UserClaude = Join-Path $env:USERPROFILE '.claude'
$TargetBase = if ($Project) { Join-Path $Project '.claude' } else { $UserClaude }

if (-not (Test-Path $SrcAgents)) { Write-Error "$SrcAgents not found — run from inside the Orcs repo"; exit 1 }
if (-not (Test-Path $SrcSkills)) { Write-Error "$SrcSkills not found — run from inside the Orcs repo"; exit 1 }

# --- preflight: required tooling (only when we actually install skills) ---
function Invoke-Preflight {
  $ok = $true
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host "error: node not found. Install Node >= 22.20 (https://nodejs.org)." -ForegroundColor Red; $ok = $false
  } else {
    $v = (& node -p 'process.versions.node').Trim()
    $parts = $v.Split('.')
    $maj = [int]$parts[0]; $min = [int]$parts[1]
    if ($maj -lt 22 -or ($maj -eq 22 -and $min -lt 20)) {
      Write-Host "error: Node $v is too old; need >= 22.20 (npx skills requires it)." -ForegroundColor Red; $ok = $false
    }
  }
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host "error: npx not found (ships with Node)." -ForegroundColor Red; $ok = $false
  }
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "error: 'claude' CLI not found. Install Claude Code first (https://claude.com/claude-code)" -ForegroundColor Red
    Write-Host "       — it must be present so the skills CLI can detect the 'claude-code' agent." -ForegroundColor Red
    $ok = $false
  }
  if (-not $ok) { Write-Error "Preflight failed. Fix the above and re-run (or use -SkipSkills)."; exit 1 }
}
if (-not $SkipSkills) { Invoke-Preflight }
foreach ($c in @('bash','jq','git')) {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) {
    Write-Error "$c not found — the harness gates need it (bash ships with Git for Windows; jq: winget install jqlang.jq)."; exit 1
  }
}

Write-Host "Installing Orcs (agents+pipeline -> $TargetBase)"

# --- 1. the 6 global skills (official sources only) ---
if (-not $SkipSkills) {
  Write-Host "== Installing the 6 global skills =="
  & npx -y skills@latest add vercel-labs/skills --skill find-skills -g -y --copy -a claude-code
  # caveman repo bundles many skills; keep only 'caveman'
  & npx -y skills@latest add JuliusBrussee/caveman --skill caveman -g -y --copy -a claude-code
  & npx -y skills@latest add rebelytics/one-skill-to-rule-them-all --skill task-observer -g -y --copy -a claude-code
  & npx -y impeccable@latest install --providers=claude --scope=global
  & claude plugin marketplace add obra/superpowers-marketplace
  & claude plugin install superpowers@superpowers-marketplace
  & npx -y claude-mem@latest install
} else {
  Write-Host "== Skipping the 6 skill installs (-SkipSkills) =="
}

# --- 2. remove legacy home-grown Orcs skills at user level ---
Write-Host "== Removing legacy Orcs skills from $UserClaude\skills =="
$legacy = @(
  'research-best-practices','options-and-confirm','write-handover-doc',
  'cost-estimation','threat-and-break','use-learned-skill','agent-self-improve',
  'analyst-skills','architect-skills','developer-skills','tester-skills','retro-skills'
)
foreach ($s in $legacy) {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $UserClaude "skills\$s")
}

# --- 3. Orcs agents + the summarised orcs-pipeline skill ---
$DstAgents = Join-Path $TargetBase 'agents'
$DstSkills = Join-Path $TargetBase 'skills'
New-Item -ItemType Directory -Force -Path $DstAgents, $DstSkills | Out-Null
foreach ($a in @('analyst','architect','developer','tester','task-observer')) {
  Copy-Item (Join-Path $SrcAgents "$a.md") $DstAgents -Force
}
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $DstAgents 'retro.md')
$dstPipeline = Join-Path $DstSkills 'orcs-pipeline'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $dstPipeline
Copy-Item (Join-Path $SrcSkills 'orcs-pipeline') $dstPipeline -Recurse -Force
Write-Host "  agents -> $DstAgents (5)"
Write-Host "  skill  -> $DstSkills\orcs-pipeline"

# --- 3b. harness kit (gates, contracts, knowledge) ---
$Kit = Join-Path $TargetBase 'orcs'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Kit
New-Item -ItemType Directory -Force -Path $Kit | Out-Null
foreach ($d in @('harness','contracts','knowledge')) { Copy-Item (Join-Path $ScriptDir $d) $Kit -Recurse -Force }
Set-Content -Path (Join-Path $Kit 'SOURCE_REPO') -Value $ScriptDir
Write-Host "  kit    -> $Kit (harness, contracts, knowledge)"

# --- 3c. stage-advance hook (idempotent merge into settings.json) ---
$Settings = Join-Path $TargetBase 'settings.json'
$HookScript = (Join-Path $Kit 'harness\hooks\block-stage-advance.sh') -replace '\\','/'
$HookCmd = "bash `"$HookScript`""
if (-not (Test-Path $Settings)) { Set-Content -Path $Settings -Value '{}' }
Copy-Item $Settings "$Settings.bak.$(Get-Date -Format yyyyMMddHHmmss)"
$cfg = Get-Content $Settings -Raw | ConvertFrom-Json
if (-not $cfg.PSObject.Properties['hooks']) { $cfg | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
$pre = @()
if ($cfg.hooks.PSObject.Properties['PreToolUse']) {
  foreach ($entry in @($cfg.hooks.PreToolUse)) {
    $kept = @($entry.hooks | Where-Object { -not ("$($_.command)" -match 'block-stage-advance\.sh') })
    if ($kept.Count -gt 0) { $entry.hooks = $kept; $pre += $entry }
  }
}
$pre += [pscustomobject]@{ matcher = 'Agent|Task'; hooks = @([pscustomobject]@{ type = 'command'; command = $HookCmd }) }
$cfg.hooks | Add-Member -NotePropertyName PreToolUse -NotePropertyValue $pre -Force
$cfg | ConvertTo-Json -Depth 20 | Set-Content -Path $Settings -Encoding UTF8
Write-Host "  hook   -> $Settings (PreToolUse Agent|Task; backup kept)"

# --- 4. global CLAUDE.md enforcement block (idempotent) ---
$ClaudeMd = Join-Path $UserClaude 'CLAUDE.md'
New-Item -ItemType Directory -Force -Path $UserClaude | Out-Null
$ws    = Join-Path $UserClaude 'task-observer-workspace'
$skill = Join-Path $UserClaude 'skills\task-observer'
$envmd = Join-Path $skill 'references\environments.md'
$projects = (Split-Path -Parent $ScriptDir)

if ((Test-Path $ClaudeMd) -and (Select-String -Path $ClaudeMd -SimpleMatch 'orcs:global:start' -Quiet)) {
  Write-Host "  CLAUDE.md orcs block already present — not duplicated"
} else {
  $block = @"

<!-- orcs:global:start -->
## Caveman voice — global, no exceptions

Operate in **caveman mode** for all natural-language output in every session: invoke the ``caveman`` skill and keep its terse, answer-first voice — every technical fact kept, all fluff gone. This applies to conversation and to prose in any document/handover you write.

- **Never** apply caveman to code, config, markup, data files, convention-bound commit messages, or any deliverable artifact — those stay correct and conventional.
- Stays on until the user says "stop caveman" / "normal mode".

## Task-observer activation

Before the first tool call of any session — and before writing or proposing a plan — invoke the ``task-observer`` skill AND run its Session Start Protocol (loading the file is not enough; the protocol is a separate step). Any turn that will involve a tool call counts. After each task, list the observation records written this session and report a one-line summary (or "none logged" with a reason per correction/incident).

Pinned paths (never resolve from the current working directory):
- Workspace root: $ws
- Skill directory: $skill
- Projects root: $projects

A subagent dispatched by a session already running task-observer does not re-run it; it writes nothing and puts findings in its report. For stricter enforcement, install the session-start hook from $envmd.
<!-- orcs:global:end -->
"@
  Add-Content -Path $ClaudeMd -Value $block
  Write-Host "  CLAUDE.md -> appended orcs global block"
}

Write-Host ""
Write-Host "Done. Harness agents: analyst, architect, developer (xN), tester, task-observer."
Write-Host "Kit: $Kit  - start a run from Git Bash in a project: bash `"$Kit/harness/init-run.sh`" ORCS-001"
Write-Host "Global skills: find-skills, caveman, task-observer, impeccable, superpowers, claude-mem; harness skill: orcs-pipeline."
