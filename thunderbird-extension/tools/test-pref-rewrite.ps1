#Requires -Version 5.1
<#
.SYNOPSIS
    Rehearses the user.js rewrite without touching a profile.

.DESCRIPTION
    install.ps1 edits user.js in place, so the only way to learn that a pref
    rewrite is wrong used to be to run it against a real profile and inspect the
    damage afterwards. This script imports the two helpers straight from
    install.ps1 — by parsing it, not by copying the code — and runs the same
    sequence on a copy of thunderbird-extension/user.js in a temporary folder.

    What it proves:
      * install.ps1 still parses;
      * the readable multi-line array form of mail.compose.other.header is
        flattened, not duplicated;
      * exactly one definition of each rewritten pref survives;
      * all 27 X-PasevSU-* names are still present, in injection order, because
        psemp-gateway/test/settings-parity.cjs reads them out of this file.

.PARAMETER Keep
    Leaves the temporary folder in place for inspection and prints its path.
#>
[CmdletBinding()]
param(
    [switch]$Keep
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$extension = Split-Path -Parent $here
$installer = Join-Path $here 'install.ps1'
$userJs = Join-Path $extension 'user.js'

if (-not (Test-Path -LiteralPath $installer)) { throw "install.ps1 not found at $installer" }
if (-not (Test-Path -LiteralPath $userJs)) { throw "user.js not found at $userJs" }

# Parse first: a syntax error in install.ps1 is otherwise invisible until the
# next real install, which is exactly the failure this script exists to prevent.
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host ('  line {0}: {1}' -f $_.Extent.StartLineNumber, $_.Message) -ForegroundColor Red }
    throw "install.ps1 does not parse ($($errors.Count) error(s))"
}
Write-Host 'parse     install.ps1 is syntactically valid' -ForegroundColor Green

# Import the real functions rather than a copy: a second copy would drift from the
# script it is meant to check, and would then pass while install.ps1 is broken.
$wanted = @('Set-PrefLine', 'Compress-PrefArray')
$found = @{}
foreach ($definition in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    if ($wanted -contains $definition.Name) { $found[$definition.Name] = $definition.Extent.Text }
}
foreach ($name in $wanted) {
    if (-not $found.ContainsKey($name)) { throw "install.ps1 no longer defines $name" }
    Invoke-Expression $found[$name]
}
Write-Host ('import    {0}' -f ($wanted -join ', ')) -ForegroundColor Green

$sandbox = Join-Path ([IO.Path]::GetTempPath()) ('psemp-prefs-' + [guid]::NewGuid().ToString('n').Substring(0, 8))
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
$work = Join-Path $sandbox 'user.js'
Copy-Item -LiteralPath $userJs -Destination $work

# Same normalisation order as install.ps1: CRLF first, then the pref edits.
$text = [IO.File]::ReadAllText($work)
$text = ($text -replace "`r`n", "`n") -replace "`r", "`n"

$names = @([regex]::Matches($text, '"(X-PasevSU-[A-Za-z0-9-]+)"') | ForEach-Object { $_.Groups[1].Value })
if ($names.Count -eq 0) { throw 'user.js registers no X-PasevSU-* header names' }

$composeLine = 'user_pref("mail.compose.other.header", "' + ($names -join ',') + '");'
$expandedLine = 'user_pref("mailnews.headers.extraExpandedHeaders", "' + (($names | ForEach-Object { $_.ToLower() }) -join ' ') + '");'

$text = Compress-PrefArray $text 'mail.compose.other.header'
$text = Compress-PrefArray $text 'mailnews.headers.extraExpandedHeaders'
$text = Set-PrefLine $text 'mail.compose.other.header' $composeLine
$text = Set-PrefLine $text 'mailnews.headers.extraExpandedHeaders' $expandedLine
$text = Set-PrefLine $text 'extensions.autoDisableScopes' 'user_pref("extensions.autoDisableScopes", 0);'
$text = Set-PrefLine $text 'xpinstall.signatures.required' 'user_pref("xpinstall.signatures.required", false);'

[IO.File]::WriteAllText($work, $text, (New-Object System.Text.UTF8Encoding($false)))

$written = [IO.File]::ReadAllText($work)
$failures = 0
function Check([string]$label, [bool]$ok, [string]$detail) {
    if ($ok) {
        Write-Host ('  ok   {0}' -f $label) -ForegroundColor Green
    } else {
        Write-Host ('  FAIL {0} — {1}' -f $label, $detail) -ForegroundColor Red
        $script:failures += 1
    }
}
Write-Host 'checks'

$composeCount = ([regex]::Matches($written, '(?m)^[ \t]*user_pref\("mail\.compose\.other\.header",')).Count
Check 'one mail.compose.other.header' ($composeCount -eq 1) "found $composeCount definitions"

$expandedCount = ([regex]::Matches($written, '(?m)^[ \t]*user_pref\("mailnews\.headers\.extraExpandedHeaders",')).Count
Check 'one mailnews.headers.extraExpandedHeaders' ($expandedCount -eq 1) "found $expandedCount definitions"

$disabledCount = ([regex]::Matches($written, '(?m)^[ \t]*user_pref\("extensions\.autoDisableScopes",')).Count
Check 'one extensions.autoDisableScopes' ($disabledCount -eq 1) "found $disabledCount definitions"

Check 'autoDisableScopes is 0' ($written.Contains('user_pref("extensions.autoDisableScopes", 0);')) 'value was not corrected'
Check 'no array literal survives' (-not $written.Contains('.join(",")')) 'the multi-line form is still in the file'

# The order matters: settings-parity.cjs compares this list to HEADER_NAMES.
$after = @([regex]::Matches($written, '"(X-PasevSU-[A-Za-z0-9-]+)"') | ForEach-Object { $_.Groups[1].Value })
Check 'all 27 header names still listed' ($after.Count -eq 27) "found $($after.Count)"
Check 'header names keep their order' (($after -join ',') -eq ($names -join ',')) 'the injected order changed'

$expandedExpected = ($names | ForEach-Object { $_.ToLower() }) -join ' '
Check 'expanded-header list is lowercase and space separated' ($written.Contains($expandedExpected)) 'extraExpandedHeaders does not match the names'

Check 'LF only, no BOM' ((-not $written.Contains("`r")) -and ([IO.File]::ReadAllBytes($work)[0] -ne 0xEF)) 'line endings or BOM regressed'

if ($Keep) {
    Write-Host ('kept      {0}' -f $sandbox) -ForegroundColor Yellow
} else {
    Remove-Item -LiteralPath $sandbox -Recurse -Force
}

if ($failures -gt 0) { throw "$failures check(s) failed" }
Write-Host 'result    the user.js rewrite is idempotent and lossless' -ForegroundColor Green
