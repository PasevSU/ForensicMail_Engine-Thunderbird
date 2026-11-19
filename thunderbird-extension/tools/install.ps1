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
$smtpUser = @{}
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
  # The outgoing server lives under mail.smtpserver.<name>., NOT mail.smtp.<name>.
  # Reading the wrong root left this table empty on every run, so the egress
  # report below skipped every identity and never printed a line — a diagnostic
  # that silently agreed with whatever the profile did.
  foreach ($match in [regex]::Matches(
    $prefsText, 'user_pref\("mail\.smtpserver\.(smtp\d+)\.hostname",\s*"([^"]+)"'
  )) { $smtpHost[$match.Groups[1].Value] = $match.Groups[2].Value }
  foreach ($match in [regex]::Matches(
    $prefsText, 'user_pref\("mail\.smtpserver\.(smtp\d+)\.username",\s*"([^"]+)"'
  )) { $smtpUser[$match.Groups[1].Value] = $match.Groups[2].Value }
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

# Two prefs on one line are invisible to every line-anchored pattern below. A file
# whose last line has no trailing newline is exactly how that happens: the next append
# glues onto it. Observed 2026-11-17 — a glued `useServerFilter` line was swallowed by
# Set-PrefLine's value match instead of being counted, so a retirement that removed 10
# lines reported 9. Split them apart rather than trusting the file's shape.
$text = ($text -split "`n" | ForEach-Object {
  if ([regex]::Matches($_, 'user_pref\(').Count -gt 1) {
    [regex]::Replace($_, ';(?=[ \t]*user_pref\()', ";`n")
  } else { $_ }
}) -join "`n"

function Set-PrefLine([string]$body, [string]$key, [string]$line) {
  # The value must not be allowed to run past `);` into a following pref: `[^\r\n]*`
  # is greedy and would rewrite two preferences as one.
  $pattern = '(?m)^[ \t]*user_pref\("' + [regex]::Escape($key) +
    '",(?:(?!user_pref)[^\r\n])*\);[ \t]*$'
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
# READ RECEIPTS ARE SWITCHED OFF FOR JUNK-MARKED MAIL, AND NOTHING HERE CAN
# SWITCH THEM BACK ON. The gate is hard-coded in the application:
# msgHdrView.js HandleMDNResponse (4391) returns before it even reads
# Disposition-Notification-To when the message carries a junkscore (4396-4400).
# It runs before the MDNReportSent check and before the nsIMsgMdnGenerator call,
# so the request is not refused — it is never seen. No pref listed in
# defaults/pref/mdn.js governs that branch, and no MailExtension API can generate
# an MDN (schemas/messages.json has no such method; ExtensionMessages.sys.mjs only
# derives the junk boolean). Two defences remain, and this block only sets up the
# first one honestly:
#
#   1. Do not let the adaptive classifier junk a correspondent silently. The
#      switch that decides whether a mailbox is filtered at all is
#      mail.server.<name>.spamLevel (mailnews.js:285, default 100; 0 turns
#      detection off). That is the operator's mail security, so it is READ and
#      reported below, never overwritten.
#   2. When a message is junk anyway, "Mark As Not Junk" rewrites junkscore to
#      IS_HAM_SCORE with origin "user" (junkCommands.js analyzeMessage), which
#      makes the gate pass again for that message. A pre-existing junk mark still
#      suppresses the receipt until it is cleared.
#
# mail.spam.manualMark is NOT a classifier switch. It only decides what happens
# to a message that is already junk — reload the header pane, or move/delete it
# (msgHdrView.js:3825-3832, bound to "When messages are marked as spam:" in
# preferences.xhtml:2165). manualMarkMode 0 pairs with it explicitly (move to the
# Spam folder) instead of relying on the default, so "marked as spam" has one
# meaning on every machine this profile is copied to.
$text = Set-PrefLine $text 'mail.spam.manualMark' 'user_pref("mail.spam.manualMark", true);'
$text = Set-PrefLine $text 'mail.spam.manualMarkMode' 'user_pref("mail.spam.manualMarkMode", 0);'
$text = Set-PrefLine $text 'mail.spam.logging.enabled' 'user_pref("mail.spam.logging.enabled", true);'
$junkAligned = @()
$junkWatched = @()
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
  # NOTHING IS WRITTEN FOR useServerFilter. An earlier version of this script set
  # it to true on every mailbox that routes junk, on the assumption that it turns
  # the per-account filter on. It does the opposite of help: useServerFilter means
  # "Trust spam headers set by:" — it imports an UPSTREAM verdict (SpamAssassin
  # and friends) and feeds it to the classifier, so it can only add junk marks,
  # never remove them. It is also inert unless serverFilterName is set
  # (MsgIncomingServer.sys.mjs:1157 returns early, and :1162 returns again without
  # a filter name), which is why the write looked harmless. Setting it on a mailbox
  # whose provider already adds an X-Spam header is a way to lose receipts, so it
  # is left exactly as the operator configured it.
  #
  # What IS done: spamLevel is read, so the run can say which mailbox can junk a
  # message at all. It is never written — turning detection off is a security
  # decision that belongs to the person reading the mail.
  if ($junkTargets -contains $serverName) {
    $level = ''
    $levelMatch = [regex]::Match(
      $prefsText, 'user_pref\("mail\.server\.' + [regex]::Escape($serverName) + '\.spamLevel",\s*(\d+)'
    )
    if ($levelMatch.Success) { $level = $levelMatch.Groups[1].Value }
    $filterName = ''
    $filterMatch = [regex]::Match(
      $prefsText, 'user_pref\("mail\.server\.' + [regex]::Escape($serverName) + '\.serverFilterName",\s*"([^"]*)"'
    )
    if ($filterMatch.Success) { $filterName = $filterMatch.Groups[1].Value }
    $junkAligned += $serverName
    $junkWatched += ('{0} (spamLevel {1}{2})' -f $serverName, $(if ($level) { $level } else { 'unset->100' }), $(if ($filterName) { ', trusts headers from ' + $filterName } else { '' }))
  }
}

# Not writing a pref is not the same as not having written it. Earlier versions of
# this script DID write mail.server.<name>.useServerFilter = true for every mailbox
# that routes junk, and those lines are still sitting in user.js on any profile this
# script has ever touched: user.js is edited in place, so a removed statement leaves
# its old output behind. On this machine that was 10 override lines, while the
# operator's own prefs.js carried the pref for 2 servers — the installer had silently
# widened their configuration and then reported "left exactly as configured".
#
# The lines live in user.js, which this script owns, so they are removed here and the
# count is printed. Removing them restores whatever prefs.js already says, which is
# the operator's real setting. This is a retirement, not a preference change, and it
# is reported for the same reason: a silent cleanup is just a quieter lie.
$staleFilterPattern = '(?m)^[ \t]*user_pref\("mail\.server\.[^"]+\.useServerFilter",'
$staleFilterCount = 0
# Work line by line: a whole-text regex has to consume the surrounding newlines to
# stay tidy, and that leaves the last line of the file glued to the previous one.
# Splitting is boring and provably preserves every other line.
$keptLines = New-Object System.Collections.Generic.List[string]
foreach ($line in ($text -split "`n")) {
  if ($line -match $staleFilterPattern) { $staleFilterCount++; continue }
  # A file that ends without a trailing newline can end up with a leftover line
  # appended onto the final pref. That case still counts and is stripped in place,
  # because dropping the line would delete the real preference in front of it.
  $stripped = [regex]::Replace(
    $line,
    '(?<=;)[ \t]*user_pref\("mail\.server\.[^"]+\.useServerFilter",[^\r\n]*\);[ \t]*$',
    ''
  )
  if ($stripped -ne $line) { $staleFilterCount++; $line = $stripped }
  $keptLines.Add($line)
}
if ($staleFilterCount -gt 0) { $text = ($keptLines -join "`n") }

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
  Write-Host ('junk      {0} mailbox(es) route junk mail: {1}' -f $junkAligned.Count, ($junkAligned -join ', '))
  foreach ($entry in $junkWatched) { Write-Host ('          ' + $entry) }
  Write-Host '          A junk-marked message never gets a read receipt: msgHdrView.js:4396 returns' -ForegroundColor DarkGray
  Write-Host '          before the request is read, and no pref or add-on can override it. Clear a mark' -ForegroundColor DarkGray
  Write-Host '          with "Mark As Not Junk" (junkCommands.js sets IS_HAM_SCORE, origin "user").' -ForegroundColor DarkGray
  Write-Host '          spamLevel is reported only — turning detection off stays your decision.' -ForegroundColor DarkGray
}
if ($staleFilterCount -gt 0) {
  Write-Host ('leftover  {0} useServerFilter line(s) removed from user.js: an earlier version' -f $staleFilterCount)
  Write-Host '          wrote them, and editing the file in place leaves their output behind even'
  Write-Host '          though the statement is gone. prefs.js keeps your real values, so nothing'
  Write-Host '          you set yourself was touched — only the override this script had added.'
}

# A receipt is dispatched through the identity's outgoing server, and the address
# the recipient's mail system answers to is the ENVELOPE sender, not the From:
# header. A hosted relay such as Brevo rewrites that envelope (Return-Path /
# SMTP MAIL FROM) to its own bounce domain. SPF and DMARC are then evaluated
# against a domain that did not sign or authorise the message for THIS sender, so
# the answer is dropped upstream — and because the original send succeeded, the
# send looks clean. The extension cannot see the envelope at all, so the honest
# thing to do is show the routing and name the limitation.
#
# A previous version of this block only compared the SMTP hostname against the
# identity's domain and warned when they differed. Even with the pref name fixed
# that test cannot find the interesting case: an identity whose SMTP hostname
# ends in its own domain (mail.<domain>) passes the comparison while the relay
# behind it still rewrites the envelope. So the comparison is gone; the full
# table is printed instead and the operator can see who sends through what.
$egress = @()
foreach ($identityId in ($smtpOf.Keys | Sort-Object)) {
  $smtpName = $smtpOf[$identityId]
  $smtpServerName = ''
  if ($smtpHost.ContainsKey($smtpName)) { $smtpServerName = $smtpHost[$smtpName] }
  $address = ''
  if ($identityEmail.ContainsKey($identityId)) { $address = $identityEmail[$identityId] }
  $user = ''
  if ($smtpUser.ContainsKey($smtpName)) { $user = $smtpUser[$smtpName] }
  if (-not $smtpServerName) { $smtpServerName = '(hostname not set)' }
  $egress += ('{0,-5} {1,-38} -> {2,-6} {3}{4}' -f $identityId, $address, $smtpName, $smtpServerName, $(if ($user -and $user -ne $address) { ' [auth ' + $user + ']' } else { '' }))
}
if ($egress.Count -gt 0) {
  Write-Host ''
  Write-Host 'egress    read receipt leaves through the identity''s outgoing server:'
  Write-Host '            identity from-address                           smtp   host'
  foreach ($line in $egress) { Write-Host ('          ' + $line) }
  Write-Host ''
  Write-Host '          What this cannot tell you: the envelope the relay actually sends.' -ForegroundColor DarkGray
  Write-Host '          A relay that rewrites Return-Path breaks SPF/DKIM/DMARC alignment, so the' -ForegroundColor DarkGray
  Write-Host '          recipient drops the receipt and the original send still looks clean.' -ForegroundColor DarkGray
  Write-Host '          Fixes, in order of preference:' -ForegroundColor DarkGray
  Write-Host '            1. Send mail that must produce a receipt from an identity whose server is' -ForegroundColor DarkGray
  Write-Host '               authoritative for its From domain (its own MX/provider, not a relay).' -ForegroundColor DarkGray
  Write-Host '            2. Keep the relay but make it DMARC-aligned: SPF include for the relay,' -ForegroundColor DarkGray
  Write-Host '               DKIM signed by the relay, relaxed alignment, own domain in From.' -ForegroundColor DarkGray
  Write-Host '            3. Accept that receipts from that identity are advisory only.' -ForegroundColor DarkGray
  Write-Host '          This script does not change your SMTP or From settings.' -ForegroundColor DarkGray
}

Write-Host ''
if ($mapped) {
  Write-Host 'The prefs above are in place; only the .xpi swap is left.' -ForegroundColor Yellow
  Write-Host 'Close Thunderbird and run this script once more.' -ForegroundColor Yellow
  exit 2
}
Write-Host "Start Thunderbird, then open the add-on options page: it must say 'Armed'." -ForegroundColor Green
