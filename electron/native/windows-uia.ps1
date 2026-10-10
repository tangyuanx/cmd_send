$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$targets = @{}
function Runtime-Key($element) { return ($element.GetRuntimeId() -join ':') }
function Checked-Element($targetId) {
    if (-not $targets.ContainsKey($targetId)) { throw '目标输入区已失效，请重新绑定' }
    $target = $targets[$targetId]
    $current = $target.element.Current
    if ($current.ProcessId -ne $target.processId -or -not $current.IsEnabled -or $current.IsOffscreen -or (Runtime-Key $target.element) -ne $target.runtime) {
        throw '目标输入区已关闭或不可输入，请重新绑定'
    }
    return $target.element
}
[Console]::WriteLine('{"type":"ready"}')
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = $line | ConvertFrom-Json
        $errorCode = 'UIA_UNAVAILABLE'
        $result = $null
        switch ($request.method) {
            'pick' {
                $position = [System.Windows.Point]::new([double]$request.x, [double]$request.y)
                $element = [System.Windows.Automation.AutomationElement]::FromPoint($position)
                $found = $null
                for ($depth = 0; $null -ne $element -and $depth -lt 24; $depth++) {
                    $current = $element.Current
                    if ($current.ProcessId -ne [int]$request.processId) { break }
                    if ($depth -eq 0 -and $current.ControlType.ProgrammaticName -match '\.(Button|CheckBox|RadioButton|MenuItem|ScrollBar|Slider|TabItem|Hyperlink)$') {
                        $errorCode = 'UIA_REJECTED'
                        throw '此区域不是文本输入区，请选择实际文本框或终端输入区'
                    }
                    $textPattern = $null
                    $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)
                    $isEdit = $current.ControlType -eq [System.Windows.Automation.ControlType]::Edit
                    if ($current.IsEnabled -and $current.IsKeyboardFocusable -and ($isEdit -or $hasText)) {
                        $valuePattern = $null
                        $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
                        if ($isEdit -and $hasValue -and $valuePattern.Current.IsReadOnly) { $errorCode = 'UIA_REJECTED'; throw '此输入区为只读，不能绑定' }
                        $found = $element
                        break
                    }
                    $element = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($element)
                }
                if ($null -eq $found) { $result = @{ supported = $false }; break }
                $targetId = [guid]::NewGuid().ToString()
                $runtime = Runtime-Key $found
                $targets[$targetId] = @{ element = $found; processId = [int]$request.processId; runtime = $runtime }
                $result = @{ targetId = $targetId; detail = $found.Current.LocalizedControlType }
            }
            'focus' {
                $element = Checked-Element $request.targetId
                $element.SetFocus()
                $result = $true
            }
            'commit' {
                $null = Checked-Element $request.targetId
                foreach ($key in @($targets.Keys)) { if ($key -ne $request.targetId) { $targets.Remove($key) } }
                $result = $true
            }
            'verify' {
                $element = Checked-Element $request.targetId
                $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
                if ($null -eq $focused -or (Runtime-Key $focused) -ne (Runtime-Key $element)) { throw '目标输入区的焦点已改变，已停止投递' }
                $result = $true
            }
            default { throw '未知的控件请求' }
        }
        $response = @{ id = $request.id; ok = $true; value = $result }
    } catch { $response = @{ id = $request.id; ok = $false; error = $_.Exception.Message; code = $errorCode } }
    [Console]::WriteLine(($response | ConvertTo-Json -Compress -Depth 5))
}

