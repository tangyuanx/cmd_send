$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
public class OpaqueInput : Control {
    public string OutputPath;
    private readonly System.Text.StringBuilder text = new System.Text.StringBuilder();
    public OpaqueInput() {
        SetStyle(ControlStyles.Selectable, true);
        TabStop = true;
        BackColor = Color.White;
        AccessibleRole = AccessibleRole.Client;
    }
    protected override void OnMouseDown(MouseEventArgs e) { Focus(); base.OnMouseDown(e); }
    protected override void OnKeyPress(KeyPressEventArgs e) {
        text.Append(e.KeyChar);
        File.WriteAllText(OutputPath, text.ToString(), new System.Text.UTF8Encoding(false));
        e.Handled = true;
    }
}
'@
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Cmd Send regression fixture'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(80,80)
$form.ClientSize = New-Object System.Drawing.Size(500,350)
$form.TopMost = $false
$raw = New-Object OpaqueInput
$raw.OutputPath = $env:CMD_SEND_FIXTURE_OUTPUT
$raw.Location = New-Object System.Drawing.Point(20,20)
$raw.Size = New-Object System.Drawing.Size(450,160)
$edit = New-Object System.Windows.Forms.TextBox
$edit.Location = New-Object System.Drawing.Point(20,210)
$edit.Size = New-Object System.Drawing.Size(450,40)
$edit.add_TextChanged({ [IO.File]::WriteAllText($env:CMD_SEND_FIXTURE_EDIT, $edit.Text, (New-Object System.Text.UTF8Encoding($false))) })
$form.Controls.Add($raw)
$form.Controls.Add($edit)
$form.Show()
$form.Activate()
$edit.Focus() | Out-Null
$point = $raw.PointToScreen((New-Object System.Drawing.Point(40,40)))
$editPoint = $edit.PointToScreen((New-Object System.Drawing.Point(40,10)))
[Console]::WriteLine((@{ ready = $true; raw = @{ x = $point.X; y = $point.Y; handle = $raw.Handle.ToInt64() }; edit = @{ x = $editPoint.X; y = $editPoint.Y; handle = $edit.Handle.ToInt64() }; window = $form.Handle.ToInt64() } | ConvertTo-Json -Compress))
[System.Windows.Forms.Application]::Run($form)
