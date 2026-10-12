$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName PresentationFramework
$window = New-Object Windows.Window
$window.Title = 'Cmd Send shared-session fixture'
$window.Width = 620; $window.Height = 380; $window.Left = 80; $window.Top = 80
$panel = New-Object Windows.Controls.StackPanel
$tabs = New-Object Windows.Controls.TabControl
$first = New-Object Windows.Controls.TabItem; $first.Header = 'Session One'
$second = New-Object Windows.Controls.TabItem; $second.Header = 'Session Two'
$null = $tabs.Items.Add($first); $null = $tabs.Items.Add($second); $tabs.SelectedIndex = 0
$input = New-Object Windows.Controls.TextBox
$input.Height = 140; $input.Margin = [Windows.Thickness]::new(16)
$input.AcceptsReturn = $true
$null = $panel.Children.Add($tabs); $null = $panel.Children.Add($input); $window.Content = $panel
# Both tabs intentionally share one input control, as many terminal apps do.
$received = @{ 'Session One' = ''; 'Session Two' = '' }
function Save-Received { [IO.File]::WriteAllText($env:CMD_SEND_TABS_OUTPUT, ($received | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false)) }
$input.Add_PreviewTextInput({ param($sender,$event)
    $key = [string]$tabs.SelectedItem.Header
    $received[$key] += $event.Text; $event.Handled = $true; Save-Received
})
$window.Add_ContentRendered({
    $input.Focus() | Out-Null
    $point = $input.PointToScreen([Windows.Point]::new(30,30))
    Save-Received
    [Console]::WriteLine((@{ ready = $true; pid = $PID; x = [int]$point.X; y = [int]$point.Y } | ConvertTo-Json -Compress))
})
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(25)
$timer.Add_Tick({
    if (Test-Path -LiteralPath $env:CMD_SEND_TABS_COMMAND) {
        $command = [IO.File]::ReadAllText($env:CMD_SEND_TABS_COMMAND)
        Remove-Item -LiteralPath $env:CMD_SEND_TABS_COMMAND
        switch ($command) {
            'second' { $tabs.SelectedIndex = 1; $input.Focus() | Out-Null }
            'replace-first' {
                $tabs.Items.Remove($first)
                $replacement = New-Object Windows.Controls.TabItem; $replacement.Header = 'Session One'
                $null = $tabs.Items.Add($replacement); $tabs.SelectedIndex = 0
            }
        }
        [Console]::WriteLine((@{ done = $command } | ConvertTo-Json -Compress))
    }
})
$timer.Start()
$null = $window.ShowDialog()
$timer.Stop()
