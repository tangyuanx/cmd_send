$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$targets = @{}
function Runtime-Key($element) { return ($element.GetRuntimeId() -join ':') }
function In-Root($element, $rootRuntime) {
    for ($depth = 0; $null -ne $element -and $depth -lt 48; $depth++) {
        if ((Runtime-Key $element) -eq $rootRuntime) { return $true }
        $element = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($element)
    }
    return $false
}
function Checked-Session($targetId, $select = $false) {
    if (-not $targets.ContainsKey($targetId)) { throw '目标输入区已失效，请重新绑定' }
    $target = $targets[$targetId]
    if ($null -ne $target.root -and (($target.root.Current.ProcessId -ne $target.hostProcessId) -or (Runtime-Key $target.root) -ne $target.rootRuntime)) { throw '目标会话窗口已关闭或被替换，请重新绑定' }
    foreach ($tab in $target.tabs) {
        if ($tab.element.Current.ProcessId -ne $tab.processId -or (Runtime-Key $tab.element) -ne $tab.runtime -or -not $tab.element.Current.IsEnabled -or -not (In-Root $tab.element $target.rootRuntime)) { throw '绑定的会话已关闭或被替换，请重新绑定' }
        $pattern = $null
        if (-not $tab.element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { throw '无法验证绑定的会话，请重新绑定' }
        if (-not $pattern.Current.IsSelected -and $select) { $pattern.Select() }
        if (-not $pattern.Current.IsSelected) { throw '会话已切换，已停止投递' }
    }
    return $target
}
function Session-Tabs($root) {
    if ($null -eq $root) { return }
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    foreach ($item in $items) {
        $pattern = $null
        if ($item.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern) -and $pattern.Current.IsSelected) {
            @{ element = $item; runtime = (Runtime-Key $item); processId = $item.Current.ProcessId; name = $item.Current.Name }
        }
    }
}
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
                $root = $null
                if ($request.window) { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([long]$request.window)) }
                $tabs = @(Session-Tabs $root)
                if ($null -eq $found -and $tabs.Count -eq 0) { $result = @{ supported = $false }; break }
                $targetId = [guid]::NewGuid().ToString()
                $runtime = if ($null -ne $found) { Runtime-Key $found } else { '' }
                $rootRuntime = if ($null -ne $root) { Runtime-Key $root } else { '' }
                $targets[$targetId] = @{ element = $found; processId = [int]$request.processId; runtime = $runtime; root = $root; rootRuntime = $rootRuntime; hostProcessId = [int]$request.hostProcessId; tabs = $tabs }
                $detail = if ($null -ne $found) { $found.Current.LocalizedControlType } else { '会话输入区' }
                $result = @{ targetId = $targetId; detail = $detail; sessionBound = ($tabs.Count -gt 0); sessionName = (($tabs | ForEach-Object { $_.name }) -join ' / '); requiresNativeFocus = ($null -eq $found) }
            }
            'focus' {
                $target = Checked-Session $request.targetId $true
                if ($null -ne $target.element) { $element = Checked-Element $request.targetId; $element.SetFocus() }
                $result = $true
            }
            'commit' {
                $target = Checked-Session $request.targetId
                if ($null -ne $target.element) { $null = Checked-Element $request.targetId }
                foreach ($key in @($targets.Keys)) { if ($key -ne $request.targetId) { $targets.Remove($key) } }
                $result = $true
            }
            'verify' {
                $target = Checked-Session $request.targetId
                if ($null -eq $target.element) { $result = $true; break }
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

