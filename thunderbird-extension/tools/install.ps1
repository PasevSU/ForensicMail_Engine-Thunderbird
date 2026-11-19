<#
.SYNOPSIS
  Build the PasevSU MailExtension into an .xpi and install it into the Thunderbird profile.

.DESCRIPTION
  Thunderbird memory-maps an installed .xpi, so it cannot be replaced while it runs:
  Windows answers "the requested operation cannot be performed on a file with a
  user-mapped section open". The extension is therefore only swapped when
  Thunderbird is closed, and Thunderbird must be restarted to load the new build.

  Run this with Thunderbird CLOSED.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile,
  [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $src 'manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$id = $manifest.browser_specific_settings.gecko.id
$version = $manifest.version
$files = @('manifest.json', 'background.js', 'options.html', 'options.js')

foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $src $f))) { throw "missing $f in $src" }
}

# Icons are read out of the manifest instead of being listed a second time: adding a
# size to manifest.json (and running tools/make-icons.cjs) is then enough for the
# archive to carry it. A declared-but-absent icon is a hard error, because Gecko
# accepts the manifest and then paints an empty button.
$declared = @()
foreach ($key in @('icons')) {
  if ($manifest.$key) {
    $declared += @($manifest.$key.PSObject.Properties | ForEach-Object { $_.Value })
  }
}
if ($manifest.browser_action -and $manifest.browser_action.default_icon) {
  $iconSpec = $manifest.browser_action.default_icon
  if ($iconSpec -is [string]) {
    $declared += $iconSpec
  } else {
    $declared += @($iconSpec.PSObject.Properties | ForEach-Object { $_.Value })
  }
}
$assets = @($declared | Where-Object { $_ -and $_.ToString().Trim() } | ForEach-Object { $_.ToString().Trim() } | Sort-Object -Unique)
foreach ($f in $assets) {
  $rel = $f.Replace('/', '\')
  if (-not (Test-Path (Join-Path $src $rel))) {
    throw "manifest declares '$f' but $rel is missing in $src (run tools/make-icons.cjs)"
  }
}

# manifest.json uses __MSG_extName__ / __MSG_extDescription__ with default_locale,
# so the archive MUST carry the _locales tree. Without it the placeholders cannot be
# resolved, Thunderbird rejects the manifest and deletes the side-loaded .xpi on the
# next start (observed 2026-11-16: the add-on simply disappeared from extensions.json).
$locales = $null
if ($manifest.default_locale) {
  $locales = Join-Path $src '_locales'
  $defaultMessages = Join-Path $locales "$($manifest.default_locale)\messages.json"
  if (-not (Test-Path $defaultMessages)) {
    throw "manifest declares default_locale '$($manifest.default_locale)' but $defaultMessages is missing"
  }
}

# Package: the files at the archive root byte-for-byte (no rewriting), plus _locales.
$xpi = Join-Path ([System.IO.Path]::GetTempPath()) "$id-$version.xpi"
if (Test-Path $xpi) { Remove-Item $xpi -Force }
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('psemp-stage-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  foreach ($f in @($files) + @($assets)) {
    $rel = $f.Replace('/', '\')
    $dst = Join-Path $stage $rel
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item (Join-Path $src $rel) $dst
  }
  if ($locales) { Copy-Item -Recurse -Force $locales (Join-Path $stage '_locales') }
  $packed = @(Get-ChildItem $stage -Recurse -File).Count
  # ZipFile.CreateFromDirectory writes Windows separators into nested entry names on
  # .NET Framework ("_locales\bg\messages.json"). Gecko cannot resolve that, so the
  # manifest's default_locale fails and Thunderbird silently deletes the add-on.
  # Entries are therefore written by hand with forward slashes.
  $archive = [System.IO.Compression.ZipFile]::Open($xpi, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem $stage -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
      $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
      $out = $entry.Open()
      try {
        $in = [System.IO.File]::OpenRead($_.FullName)
        try { $in.CopyTo($out) } finally { $in.Dispose() }
      } finally { $out.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally {
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
Write-Host ('built  {0} ({1} bytes, {2} files, version {3})' -f $xpi, (Get-Item $xpi).Length, $packed, $version)

if ($BuildOnly) { return }

if (-not $Profile) {
  $profilesRoot = Join-Path $env:APPDATA 'Thunderbird\Profiles'
  $candidates = @(Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*.default-esr' -or $_.Name -like '*.default' })
  if ($candidates.Count -eq 0) { throw "no Thunderbird profile found under $profilesRoot" }
  if ($candidates.Count -gt 1) {
    $default = ''
    $ini = Join-Path $env:APPDATA 'Thunderbird\profiles.ini'
    if (Test-Path $ini) {
      $m = Select-String -Path $ini -Pattern '^Default=(.+)$' | Select-Object -First 1
      if ($m) { $default = $m.Matches.Groups[1].Value.Trim() }
    }
    $picked = $candidates | Where-Object { $default -and $default.EndsWith($_.Name) } | Select-Object -First 1
    if (-not $picked) { $picked = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
    $Profile = $picked.FullName
  } else {
    $Profile = $candidates[0].FullName
  }
}

$extDir = Join-Path $Profile 'extensions'
if (-not (Test-Path $extDir)) { New-Item -ItemType Directory -Path $extDir | Out-Null }
$dest = Join-Path $extDir "$id.xpi"

$mapped = $false
try {
  Copy-Item $xpi $dest -Force -ErrorAction Stop
} catch {
  $mapped = $true
  Write-Host ''
  Write-Host 'Could not replace the installed .xpi: Thunderbird keeps it memory-mapped.' -ForegroundColor Yellow
  Write-Host 'Close Thunderbird completely and run this again.' -ForegroundColor Yellow
  Write-Host ('  reason: {0}' -f $_.Exception.Message) -ForegroundColor Yellow
}

if (-not $mapped) {
  $srcHash = (Get-FileHash $xpi -Algorithm SHA256).Hash.ToLower()
  $dstHash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
  if ($srcHash -ne $dstHash) { throw "installed file does not match the build ($srcHash vs $dstHash)" }
  Write-Host ('installed {0}' -f $dest)
  Write-Host ('sha256    {0}' -f $dstHash)
}

# Thunderbird keeps only the custom headers whose names are registered in
# mail.compose.other.header, and the message pane shows only the ones listed in
# mailnews.headers.extraExpandedHeaders. A profile written by an older build
# carries a shorter list, so both prefs are rebuilt from background.js here:
# a new header is otherwise computed, passed to the send, and dropped on the wire.
$bgPath = Join-Path $src 'background.js'
$bgText = [IO.File]::ReadAllText($bgPath)
$names = [regex]::Matches(
  $bgText, "buildHeader\(\s*['`"](X-PasevSU-[A-Za-z0-9-]+)['`"]"
) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
if ($names.Count -eq 0) { throw "no X-PasevSU- header names found in $bgPath" }

# The receipt switches are per identity and per server, and they live in the
# profile, not in the extension. A profile that has never asked for a receipt has
# no such prefs at all, which is why "the extension requests it" was not enough:
# the account said no. The ids are therefore READ from this profile instead of
# being assumed — a new account, a removed one or a renamed one needs no edit
# here, only another run. `identities[].request_return_receipt_on` is the switch
# the compose window consults; the `mdn_*` quartet on the server side decides
# when the answer is actually sent (0 = never, 1 = always, 2 = ask).
$prefsJs = Join-Path $Profile 'prefs.js'
$prefsText = ''
$identityIds = @()
$serverNames = @()
$junkTargets = @()
$smtpOf = @{}
$smtpHost = @{}
$identityEmail = @{}
if (Test-Path $prefsJs) {
  $prefsText = [IO.File]::ReadAllText($prefsJs)
  $identityIds = [regex]::Matches(
    $prefsText, 'user_pref\("mail\.identity\.(id\d+)\.useremail"'
  ) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  $serverNames = [regex]::Matches(
    $prefsText, 'user_pref\("mail\.server\.(server\d+)\.'
  ) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  # Which servers actually have a junk destination, and which SMTP server each
  # identity sends through. Both are read, never assumed: the two defects below
  # are about accounts that are NOT configured the same way, so an id or a
  # hostname hard-coded here would be wrong on the next profile.
  $junkTargets = [regex]::Matches(
    $prefsText, 'user_pref\("mail\.server\.(server\d+)\.spamActionTargetAccount"'
  ) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  foreach ($match in [regex]::Matches(
    $prefsText, 'user_pref\("mail\.identity\.(id\d+)\.smtpServer",\s*"([^"]+)"'
  )) { $smtpOf[$match.Groups[1].Value] = $match.Groups[2].Value }
  foreach ($match in [regex]::Matches(
    $prefsText, 'user_pref\("mail\.identity\.(id\d+)\.useremail",\s*"([^"]+)"'
  )) { $identityEmail[$match.Groups[1].Value] = $match.Groups[2].Value }
  foreach ($match in [regex]::Matches(
    $prefsText, 'user_pref\("mail\.smtp\.(smtp\d+)\.hostname",\s*"([^"]+)"'
  )) { $smtpHost[$match.Groups[1].Value] = $match.Groups[2].Value }
}
if ($identityIds.Count -eq 0) {
  Write-Host 'no identity found in prefs.js — receipt prefs are left untouched' -ForegroundColor Yellow
}

$userJs = Join-Path $Profile 'user.js'
$hadUserJs = Test-Path $userJs
$text = if ($hadUserJs) { [IO.File]::ReadAllText($userJs) } else { '' }
if ($hadUserJs) {
  Copy-Item $userJs (Join-Path $Profile 'user.js.psemp-before-install') -Force
}

# Normalise BEFORE the edits below, not after. Set-PrefLine anchors on `;[ \t]*$`,
# and in multiline mode `$` matches before "\n" but not before "\r" — so on a CRLF
# file the pattern cannot match, and every pref it was asked to replace is instead
# appended as a second copy. Observed 2026-11-17: a CRLF user.js ended up with two
# `extensions.autoDisableScopes` lines, the first still 15.
$text = ($text -replace "`r`n", "`n") -replace "`r", "`n"

function Set-PrefLine([string]$body, [string]$key, [string]$line) {
  $pattern = '(?m)^[ \t]*user_pref\("' + [regex]::Escape($key) + '",[^\r\n]*\);[ \t]*$'
  if ([regex]::IsMatch($body, $pattern)) { return [regex]::Replace($body, $pattern, $line) }
  return $body.TrimEnd() + "`n" + $line
}

# user.js may carry a list-valued pref as a multi-line array literal, one entry
# per line, because 27 header names on one line are unreadable:
#
#   user_pref(
#     "mail.compose.other.header",
#     [
#       "X-PasevSU-Version",
#       ...
#     ].join(","),
#   );
#
# Set-PrefLine matches ONE line by design, so it could not see that literal and
# silently APPENDED a second definition of the same key. The duplicate stayed
# invisible because user.js is applied in file order and the appended line came
# last — the file still "worked", while carrying two contradictory values. This
# helper flattens the array form into the equivalent one-line form FIRST, so the
# replacement below has a single line to rewrite and the profile ends up with
# exactly one mail.compose.other.header.
function Compress-PrefArray([string]$body, [string]$key) {
  $pattern = '(?s)(?m)^[ \t]*user_pref\(\s*"' + [regex]::Escape($key) +
    '"\s*,\s*\[(.*?)\]\s*\.join\(\s*"([^"]*)"\s*\)\s*,?\s*\)\s*;[ \t]*$'
  $match = [regex]::Match($body, $pattern)
  while ($match.Success) {
    $separator = $match.Groups[2].Value
    $values = @([regex]::Matches($match.Groups[1].Value, '"([^"]*)"') |
      ForEach-Object { $_.Groups[1].Value })
    $line = 'user_pref("' + $key + '", "' + ($values -join $separator) + '");'
    $body = $body.Substring(0, $match.Index) + $line +
      $body.Substring($match.Index + $match.Length)
    $match = [regex]::Match($body, $pattern)
  }
  return $body
}

$composeLine = 'user_pref("mail.compose.other.header", "' + ($names -join ',') + '");'
$expandedLine = 'user_pref("mailnews.headers.extraExpandedHeaders", "' + (($names | ForEach-Object { $_.ToLower() }) -join ' ') + '");'
# These two decide whether the add-on is ARMED after a rebuild, so their values
# are enforced, not merely added:
#
#   extensions.autoDisableScopes = 0   Thunderbird's default registers an .xpi that
#       was hand-placed in <profile>\extensions\ with userDisabled: true, so the
#       add-on is installed and inert. Any non-zero mask re-disables it after every
#       rebuild, which breaks the standing requirement that the headers appear
#       without anyone touching the Add-ons Manager.
#   xpinstall.signatures.required = false   Thunderbird's factory value is already
#       false (greprefs.js), but a profile that copied a Firefox-style user.js can
#       carry `true`, and then the unsigned hand-built .xpi is refused outright.
#
# Set-PrefLine REPLACES an existing line, so a profile that says 15 (the value
# chosen for a "confirm every side-load" posture) is corrected here rather than
# left contradicting the build.
$text = Compress-PrefArray $text 'mail.compose.other.header'
$text = Compress-PrefArray $text 'mailnews.headers.extraExpandedHeaders'
$text = Set-PrefLine $text 'mail.compose.other.header' $composeLine
$text = Set-PrefLine $text 'mailnews.headers.extraExpandedHeaders' $expandedLine
$text = Set-PrefLine $text 'extensions.autoDisableScopes' 'user_pref("extensions.autoDisableScopes", 0);'
$text = Set-PrefLine $text 'xpinstall.signatures.required' 'user_pref("xpinstall.signatures.required", false);'

# The receipt prefs are written for EVERY identity in this profile, and the ids
# come from prefs.js above, so switching identity in the compose window cannot
# quietly turn the request off. (Observed: id8 asked for a receipt, id9 — the
# identity actually in use — had no pref at all, so half the accounts were silent.)
foreach ($identityId in $identityIds) {
  $text = Set-PrefLine $text "mail.identity.$identityId.request_return_receipt_on" `
    ('user_pref("mail.identity.{0}.request_return_receipt_on", true);' -f $identityId)
}
# The global switch Thunderbird consults before offering the checkbox at all, and
# the four policy gates that decide whether an inbound request is honoured:
# on / not_in_to_cc / outside_domain / other. 1 = report, 2 = ask, 0 = never.
# A receipt the extension asked for must be answered by this machine too, or the
# other half of the loop stays silent.
$text = Set-PrefLine $text 'mail.receipt.request_return_receipt_on' 'user_pref("mail.receipt.request_return_receipt_on", true);'
$text = Set-PrefLine $text 'mail.mdn.report.enabled' 'user_pref("mail.mdn.report.enabled", true);'
foreach ($policy in @('not_in_to_cc', 'outside_domain', 'other')) {
  $text = Set-PrefLine $text "mail.mdn.report.$policy" ('user_pref("mail.mdn.report.{0}", 1);' -f $policy)
}
# Mail that carries the junk flag is never offered for a read receipt:
# Thunderbird skips the MDN bar for isJunk messages, and a MailExtension cannot
# reach that code path. The profile-side answer — and the only one that survives
# an application update — is to stop the local classifier from disqualifying a
# correspondent behind the operator's back. manualMark means a header is tagged
# junk only when a filter or the operator asks for it, so an ordinary sender is
# never silently excluded from the receipt loop. Logging is kept on so that when a
# receipt IS suppressed, junklog.html shows whether a junk mark caused it.
$text = Set-PrefLine $text 'mail.spam.manualMark' 'user_pref("mail.spam.manualMark", true);'
$text = Set-PrefLine $text 'mail.spam.logging.enabled' 'user_pref("mail.spam.logging.enabled", true);'
$junkAligned = @()
foreach ($serverName in $serverNames) {
  $text = Set-PrefLine $text "mail.server.$serverName.mdn_report_enabled" `
    ('user_pref("mail.server.{0}.mdn_report_enabled", true);' -f $serverName)
  # The per-server trio the profile actually carries (server13 already has all
  # three). Writing only the global `mail.mdn.report.*` would leave a server with
  # its own policy in charge, which is how "the checkbox is on but nothing comes
  # back" happened.
  foreach ($policy in @('not_in_to_cc', 'outside_domain', 'other')) {
    $text = Set-PrefLine $text "mail.server.$serverName.mdn_$policy" `
      ('user_pref("mail.server.{0}.mdn_{1}", 1);' -f $serverName, $policy)
  }
  # The junk filter belongs to the server, and this switch decides whether that
  # account is filtered at all. It was set on the two accounts that were
  # configured by hand and absent on the other eight, so the same message could be
  # junk-tagged — and lose its receipt — on one mailbox and not on another. It is
  # written for every server that has a junk destination in THIS profile; the list
  # comes from prefs.js, so a newly added account is covered without editing here.
  if ($junkTargets -contains $serverName) {
    $text = Set-PrefLine $text "mail.server.$serverName.useServerFilter" `
      ('user_pref("mail.server.{0}.useServerFilter", true);' -f $serverName)
    $junkAligned += $serverName
  }
}

# A duplicate key is not harmless: user.js is applied in file order and the LAST
# assignment wins, so a stale `autoDisableScopes = 15` earlier in the file would
# still look "fixed" while the file carries the old value too. Set-PrefLine uses
# [regex]::Replace, which rewrites every match instead of collapsing them, so the
# duplicates are removed here by keeping only the last line per key.
$lines = $text -split "`n"
$lastIndexOf = @{}
for ($i = 0; $i -lt $lines.Count; $i += 1) {
  if ($lines[$i] -match '^[ \t]*user_pref\("([^"]+)",') { $lastIndexOf[$matches[1]] = $i }
}
$kept = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $lines.Count; $i += 1) {
  if ($lines[$i] -match '^[ \t]*user_pref\("([^"]+)",' -and $lastIndexOf[$matches[1]] -ne $i) { continue }
  $kept.Add($lines[$i])
}
$text = ($kept -join "`n")

$text = $text.TrimEnd()
if (-not $text.EndsWith(';')) { $text += ';' }
[IO.File]::WriteAllText($userJs, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ('user.js   {0} header names registered, LF, no BOM' -f $names.Count)
if ($identityIds.Count -gt 0) {
  Write-Host ('prefs     receipts requested for {0} identity(ies), {1} server(s) answer MDNs' -f $identityIds.Count, $serverNames.Count)
}
if ($junkAligned.Count -gt 0) {
  Write-Host ('junk      one filter setting for every mailbox: {0}' -f ($junkAligned -join ', '))
}

# Delivery receipts leave through the identity's SMTP server, and a relay that
# rewrites the envelope (a hosted relay such as Brevo does) breaks the address the
# recipient's server answers to — the MDN goes nowhere and the send looks clean.
# The extension cannot see the envelope, so the only honest thing to do is read
# which identity uses which host and say so, instead of promising receipts that a
# relay will swallow.
$relayed = @()
foreach ($identityId in $smtpOf.Keys) {
  $smtpName = $smtpOf[$identityId]
  $smtpServerName = ''
  if ($smtpHost.ContainsKey($smtpName)) { $smtpServerName = $smtpHost[$smtpName] }
  $address = ''
  if ($identityEmail.ContainsKey($identityId)) { $address = $identityEmail[$identityId] }
  # An identity is "relayed" when it sends through a host outside its own domain.
  # Both sides of that comparison come from prefs.js: no hostname is written into
  # this script, so the warning follows whatever the profile actually does.
  if (-not $smtpServerName) { continue }
  $domain = ''
  if ($address -match '@([^@]+)$') { $domain = $matches[1] }
  if (-not $domain) { continue }
  if ($smtpServerName -notlike ('*' + $domain)) {
    $relayed += ('{0} ({1}) -> {2} ({3})' -f $identityId, $address, $smtpName, $smtpServerName)
  }
}
if ($relayed.Count -gt 0) {
  Write-Host ''
  Write-Host 'Relay warning: these identities send through a host outside their own domain.' -ForegroundColor Yellow
  foreach ($line in $relayed) { Write-Host ('  ' + $line) -ForegroundColor Yellow }
  Write-Host '  A relay that rewrites the envelope can lose the read/delivery receipt. Use an' -ForegroundColor Yellow
  Write-Host '  identity that sends through its own domain for mail that must come back with one.' -ForegroundColor Yellow
}

Write-Host ''
if ($mapped) {
  Write-Host 'The prefs above are in place; only the .xpi swap is left.' -ForegroundColor Yellow
  Write-Host 'Close Thunderbird and run this script once more.' -ForegroundColor Yellow
  exit 2
}
Write-Host "Start Thunderbird, then open the add-on options page: it must say 'Armed'." -ForegroundColor Green
