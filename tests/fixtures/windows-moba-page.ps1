$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Windows.Forms;
public class PageOutput : Panel {
    public PageOutput() { TabStop = false; BackColor = Color.White; }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.DrawString("Read-only session output fixture", Font, Brushes.Black, 20, 20);
        base.OnPaint(e);
    }
}
public static class NativePage {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr h, IntPtr parent);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x,int y,int w,int hgt,uint flags);
}
'@
$terminal = [IntPtr][long]$env:CMD_SEND_MOBA_TERMINAL
$parent = [NativePage]::GetParent($terminal)
$rect = New-Object NativePage+RECT
if (-not [NativePage]::GetWindowRect($terminal,[ref]$rect)) { throw 'Terminal bounds unavailable' }
$origin = New-Object NativePage+POINT
$origin.x=$rect.left; $origin.y=$rect.top
if (-not [NativePage]::ScreenToClient($parent,[ref]$origin)) { throw 'Page origin unavailable' }
$panel = New-Object PageOutput
$handle = $panel.Handle
[NativePage]::SetParent($handle,$parent) | Out-Null
$width=$rect.right-$rect.left
$height=[Math]::Max(60,[int](($rect.bottom-$rect.top)*0.7))
if (-not [NativePage]::SetWindowPos($handle,[IntPtr]::Zero,$origin.x,$origin.y,$width,$height,0x40)) { throw 'Output fixture unavailable' }
[Console]::WriteLine((@{ready=$true;handle=$handle.ToInt64();x=$rect.left+[int]($width/2);y=$rect.top+[int]($height/2)} | ConvertTo-Json -Compress))
try { [System.Windows.Forms.Application]::Run() } finally { $panel.Dispose() }
