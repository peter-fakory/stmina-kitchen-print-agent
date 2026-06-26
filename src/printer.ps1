# src/printer.ps1
# Ported from stmina-gateway/src/printer.ps1 — same RAW Win32 printing technique
# (winspool.Drv via P/Invoke), extended with drawer-kick and status actions.

param(
  [string]$PrinterName,
  [Parameter(Mandatory=$true)][ValidateSet("print", "drawer-kick", "status", "list-printers")][string]$Action,
  [string]$FilePath,
  [int]$CutN = 2,
  [int]$ReceiptCpl = 48
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static int SendBytes(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("OpenPrinter failed. Win32Error=" + Marshal.GetLastWin32Error());

        try
        {
            var di = new DOCINFOA();
            di.pDocName = "StMina Print Agent Job";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("StartDocPrinter failed. Win32Error=" + Marshal.GetLastWin32Error());

            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed. Win32Error=" + Marshal.GetLastWin32Error());

                try
                {
                    IntPtr unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);

                    try
                    {
                        int written;
                        if (!WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written))
                            throw new Exception("WritePrinter failed. Win32Error=" + Marshal.GetLastWin32Error());
                        return written;
                    }
                    finally
                    {
                        Marshal.FreeCoTaskMem(unmanagedBytes);
                    }
                }
                finally
                {
                    EndPagePrinter(hPrinter);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
"@

$enc = [System.Text.Encoding]::ASCII
$CRLF = [byte[]](0x0D, 0x0A)

# Star Line Mode formatting commands
$EMPH_ON  = [byte[]](0x1B, 0x45)
$EMPH_OFF = [byte[]](0x1B, 0x46)
$WIDE_ON  = [byte[]](0x1B, 0x57, 0x01)
$WIDE_OFF = [byte[]](0x1B, 0x57, 0x00)
$HIGH_ON  = [byte[]](0x1B, 0x68, 0x01)
$HIGH_OFF = [byte[]](0x1B, 0x68, 0x00)
$INIT     = [byte[]](0x1B, 0x40)
$CUT      = [byte[]](0x1B, 0x64, [byte]$CutN)

# Star Line Mode "External device 1 drive instruction" — single BEL byte (0x07).
# Verified against Star's official Command Emulator / Line Mode spec for TSP100:
# ESC BEL (0x1B 0x07) is a DIFFERENT command ("set pulse width for external
# device drive" — config only, does not fire). BEL alone is the actual trigger.
$DRAWER_KICK = [byte[]](0x07)

function Get-PrinterStatusInfo {
  param([string]$Name)

  $result = [ordered]@{
    printerFound = $false
    printerName  = $Name
    status       = $null
    jobCount     = $null
    portName     = $null
    workOffline  = $null
    detectedErrorState = $null
  }

  $printer = Get-Printer -Name $Name -ErrorAction SilentlyContinue
  if (-not $printer) {
    $available = (Get-Printer | Select-Object -ExpandProperty Name) -join ", "
    $result.availablePrinters = $available
    return $result
  }

  $result.printerFound = $true
  $result.status = [string]$printer.PrinterStatus
  $result.jobCount = $printer.JobCount
  $result.portName = $printer.PortName

  $wmi = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$($Name -replace "'", "''")'" -ErrorAction SilentlyContinue
  if ($wmi) {
    $result.workOffline = $wmi.WorkOffline
    $result.detectedErrorState = $wmi.DetectedErrorState
  }

  return $result
}

switch ($Action) {
  "list-printers" {
    $names = Get-Printer | Select-Object -ExpandProperty Name
    @{ printers = @($names) } | ConvertTo-Json -Compress
    exit 0
  }

  "status" {
    $info = Get-PrinterStatusInfo -Name $PrinterName
    $info | ConvertTo-Json -Compress
    exit 0
  }

  "drawer-kick" {
    $written = [RawPrinter]::SendBytes($PrinterName, $DRAWER_KICK)
    @{ ok = $true; bytesWritten = $written } | ConvertTo-Json -Compress
    exit 0
  }

  "print" {
    if (-not $FilePath -or !(Test-Path -LiteralPath $FilePath)) {
      throw "File not found: $FilePath"
    }

    $printerCheck = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
    if (-not $printerCheck) {
      $available = (Get-Printer | Select-Object -ExpandProperty Name) -join "`n - "
      throw "Printer not found: '$PrinterName'.`nAvailable printers:`n - $available"
    }

    $text = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    $text = $text -replace "`r?`n", "`n"
    $lines = $text -split "`n", 0

    $outBytes = New-Object 'System.Collections.Generic.List[byte]'
    $outBytes.AddRange($INIT)

    foreach ($line in $lines) {
      if ($line -match '^\[\[BIG\]\](.*)\[\[/BIG\]\]$') {
        $inner = ($Matches[1]).Trim()
        $len = $inner.Length
        $leftSpaces = [math]::Max(0, [math]::Floor(($ReceiptCpl - (2 * $len)) / 4))
        $centered = (" " * $leftSpaces) + $inner

        $outBytes.AddRange($EMPH_ON)
        $outBytes.AddRange($WIDE_ON)
        $outBytes.AddRange($HIGH_ON)
        $outBytes.AddRange($enc.GetBytes($centered))
        $outBytes.AddRange($CRLF)
        $outBytes.AddRange($HIGH_OFF)
        $outBytes.AddRange($WIDE_OFF)
        $outBytes.AddRange($EMPH_OFF)
      }
      elseif ($line -match '^(.*)\[\[BOLD\]\](.*?)\[\[/BOLD\]\](.*)$') {
        # Inline bold — only the marked segment is emphasized, rest of the line stays normal.
        $before = $Matches[1]
        $bold   = $Matches[2]
        $after  = $Matches[3]

        $outBytes.AddRange($enc.GetBytes($before))
        $outBytes.AddRange($EMPH_ON)
        $outBytes.AddRange($enc.GetBytes($bold))
        $outBytes.AddRange($EMPH_OFF)
        $outBytes.AddRange($enc.GetBytes($after))
        $outBytes.AddRange($CRLF)
      }
      else {
        $outBytes.AddRange($enc.GetBytes($line))
        $outBytes.AddRange($CRLF)
      }
    }

    $outBytes.AddRange($CRLF)
    $outBytes.AddRange($CRLF)
    $outBytes.AddRange($CUT)

    $written = [RawPrinter]::SendBytes($PrinterName, $outBytes.ToArray())
    @{ ok = $true; bytesWritten = $written; bytesIntended = $outBytes.Count } | ConvertTo-Json -Compress
    exit 0
  }
}
