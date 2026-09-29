import { app, ipcMain, BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

/**
 * Media droplet backend.
 *
 * Reads the Windows System Media Transport Controls (SMTC) — the same source
 * the volume flyout uses — so Spotify, browsers, Apple Music etc. all work
 * without per-app integrations. A single long-lived PowerShell process polls
 * the session and prints one JSON line per change; commands go in via stdin.
 * Only runs while at least one renderer is subscribed.
 */

export interface MediaState {
  active: boolean;
  status?: "playing" | "paused" | "stopped";
  title?: string;
  artist?: string;
  album?: string;
  app?: string;
  /** base64 JPEG/PNG, without the data: prefix. */
  cover?: string;
  coverMime?: string;
  positionMs?: number;
  durationMs?: number;
  canNext?: boolean;
  canPrev?: boolean;
}

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + String.raw`1'
})[0]
function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Pick-Session {
  $best = $null
  foreach ($s in $mgr.GetSessions()) {
    if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $s }
  }
  return $mgr.GetCurrentSession()
}

function Get-Cover($props) {
  try {
    if ($null -eq $props.Thumbnail) { return $null }
    $rs = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # PowerShell's binder can't convert the WinRT stream to IInputStream; reflection can.
    $asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
    $stream = $asStream.Invoke($null, @($rs))
    $ms = New-Object System.IO.MemoryStream
    $stream.CopyTo($ms)
    $mime = $rs.ContentType
    $stream.Dispose()
    if ($ms.Length -eq 0) { return $null }
    return @{ data = [Convert]::ToBase64String($ms.ToArray()); mime = $mime }
  } catch { return $null }
}

$lastKey = ''
$lastCoverKey = ''
$cover = $null
$coverTries = 0
$lastEmit = [DateTime]::MinValue
$stdin = [Console]::OpenStandardInput()
$stdinBuf = New-Object byte[] 256
# Console.In.ReadLineAsync blocks synchronously on a piped stdin; the raw stream's ReadAsync does not.
$readTask = $stdin.ReadAsync($stdinBuf, 0, $stdinBuf.Length)

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

while ($true) {
  try {
    if ($readTask.IsCompleted) {
      $count = $readTask.Result
      if ($count -le 0) { break }
      $text = [System.Text.Encoding]::UTF8.GetString($stdinBuf, 0, $count)
      $readTask = $stdin.ReadAsync($stdinBuf, 0, $stdinBuf.Length)
      $s = Pick-Session
      if ($null -ne $s) {
        foreach ($line in $text.Split([char]10)) {
          switch ($line.Trim()) {
            'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
            'next'   { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
            'prev'   { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
          }
        }
      }
      $lastKey = ''
    }

    $s = Pick-Session
    if ($null -eq $s) {
      if ($lastKey -ne 'none') { Emit @{ active = $false }; $lastKey = 'none' }
    } else {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $status = $info.PlaybackStatus.ToString().ToLower()
      if ($status -ne 'playing' -and $status -ne 'paused') { $status = 'stopped' }
      $trackKey = "$($s.SourceAppUserModelId)|$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      if ($trackKey -ne $lastCoverKey) { $lastCoverKey = $trackKey; $cover = $null; $coverTries = 0 }
      if ($null -eq $cover -and $coverTries -lt 40) { $cover = Get-Cover $props; $coverTries++ }
      $ctl = $info.Controls
      $key = "$trackKey|$status|$($null -ne $cover)|$($ctl.IsNextEnabled)|$($ctl.IsPreviousEnabled)"
      $now = [DateTime]::UtcNow
      if ($key -ne $lastKey -or ($now - $lastEmit).TotalSeconds -ge 5) {
        $lastKey = $key
        $lastEmit = $now
        $obj = @{
          active = $true
          status = $status
          title = [string]$props.Title
          artist = [string]$props.Artist
          album = [string]$props.AlbumTitle
          app = [string]$s.SourceAppUserModelId
          positionMs = [int64]($tl.Position.TotalMilliseconds)
          durationMs = [int64](($tl.EndTime - $tl.StartTime).TotalMilliseconds)
          canNext = [bool]$ctl.IsNextEnabled
          canPrev = [bool]$ctl.IsPreviousEnabled
        }
        if ($null -ne $cover) { $obj.cover = $cover.data; $obj.coverMime = $cover.mime }
        Emit $obj
      }
    }
  } catch { }
  Start-Sleep -Milliseconds 300
}
`;

let proc: ChildProcessWithoutNullStreams | null = null;
let lastState: MediaState = { active: false };
let subscribers = 0;
let getTargetWindows: () => (BrowserWindow | null)[] = () => [];

function broadcast(): void {
  for (const win of getTargetWindows()) {
    if (win && !win.isDestroyed()) win.webContents.send("media:state", lastState);
  }
}

function start(): void {
  if (proc || process.platform !== "win32") return;
  try {
    const scriptPath = path.join(app.getPath("userData"), "media-bridge.ps1");
    // BOM so Windows PowerShell 5.1 reads the file as UTF-8.
    fs.writeFileSync(scriptPath, "﻿" + PS_SCRIPT, "utf8");
    proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true },
    );
    proc.stdout.setEncoding("utf8");
    let buffer = "";
    proc.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          lastState = JSON.parse(line) as MediaState;
          broadcast();
        } catch {
          // ignore non-JSON noise
        }
      }
    });
    proc.stderr.on("data", (d) => logger.warn(`media-bridge: ${String(d).trim()}`));
    proc.on("exit", () => {
      proc = null;
      lastState = { active: false };
      broadcast();
    });
    proc.on("error", (err) => {
      logger.error("media-bridge failed to start:", err);
      proc = null;
    });
  } catch (err) {
    logger.error("Failed to start media bridge:", err);
    proc = null;
  }
}

export function stopMediaService(): void {
  subscribers = 0;
  if (proc) {
    proc.kill();
    proc = null;
  }
}

export function registerMediaHandlers(windows: () => (BrowserWindow | null)[]): void {
  getTargetWindows = windows;

  // Renderer opts in/out; the PowerShell process only lives while enabled.
  ipcMain.handle("media:set-enabled", async (_e, enabled: boolean) => {
    if (enabled) {
      subscribers = 1;
      start();
      return { success: true, state: lastState };
    }
    stopMediaService();
    lastState = { active: false };
    return { success: true, state: lastState };
  });

  ipcMain.handle("media:get-state", async () => ({ success: true, state: lastState }));

  ipcMain.on("media:command", (_e, cmd: "toggle" | "next" | "prev") => {
    if (!proc || !["toggle", "next", "prev"].includes(cmd)) return;
    proc.stdin.write(cmd + "\n");
  });
}
