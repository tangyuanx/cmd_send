# 本地验证记录 · 2026-10-09

## v0.1.2 Windows 目标识别修复 · 2026-10-10

- 旧实现将非 Edit/RichEdit 控件绑定强制限制为 UI Automation Edit/TextPattern 且可聚焦；没有这些接口的终端、自绘输入区会被拒绝。新增 HWND 与客户端位置回退，发送前点击恢复焦点并记录实际焦点句柄。
- 逐字符与回车接口原先丢弃异步 Promise，已修复，队列能等待焦点校验/投递，停止期间不会发出延迟字符。
- Linux 本地解析/文件/队列/Windows 模拟接口测试共 24 项通过（解析测试内含 15 条断言），Windows/macOS 原生检查在当前平台明确跳过。
- Windows 专属桌面测试启动自己的 WinForms 测试进程，绑定没有 TextPattern 的自绘输入区，验证中文/emoji/回车、切换焦点后停止、Edit 后台投递和目标关闭；由远程 Windows 构建运行。第三方终端未在本地真机验证。
- 主分支版本变化后自动发布；仅在 Windows/macOS 测试与构建均成功时创建 Tag 并公开完整 Release。

## v0.1.1 无边框更新

- 真实 Mac 窗口中仅有自定义窗口操作按钮，已去掉系统红黄绿按钮。
- 最大化后按钮切换为「还原窗口」，点击还原后恢复「最大化窗口」；已执行最小化、恢复和顶部拖动。
- 从自定义关闭按钮触发未保存修改提示，取消退出后修改仍在；恢复原内容后通过关闭按钮正常退出。
- ⌘O 能打开真实文件选择窗口，正常载入快速验证 TXT。Windows 移除窗口菜单后仍提供 Ctrl+O / Ctrl+S / Ctrl+W。
- 本地解析、文件、队列及 Mac 原生加载测试通过；Windows 专属加载检查在 Mac 跳过，由远程 Windows 自动检查执行。Windows 无边框交互尚未实机验证。

## v0.1.0 初版

用户已于 2026-10-09 授权推送并发布 v0.1.0。以下为发布前的本地验证记录，未验证项保持原结论。验证环境为 Apple Silicon，macOS 26.6.2。

- 15 项命令范围、标题、注释与选区解析检查，5 项文件测试、8 项发送队列测试、Mac 原生接口加载测试均通过。
- 队列检查覆盖 A B C A B C、首条不额外等待、跨轮间隔、中文与 emoji、暂停续传、循环停止、含歧义失败不重试、停止过程不再完成旧任务，以及退出等待原生调用清理。
- 文件检查覆盖 BOM/CRLF、重复路径和软链接复用、不同目录同名文件、磁盘外部修改保护、失败保留原文件、并发保存。
- 真实 `.app` 已启动，通过界面打开磁盘 TXT，生成场景目录并定位命令；查找 echo 显示 3 处匹配；真实置顶开关有反馈。截图位于本地 `screenshots/mac-desktop.png`。
- Mac 包完成 ad-hoc 签名并通过严格签名校验，未使用 Developer ID、未公证。
- Windows x64 交叉构建成功。EXE 与 Koffi 模块均为 PE32+ x86-64；具体控件识别脚本随包携带。
- Windows 原生加载和 UI Automation 运行测试在 Mac 明确跳过；仓库工作流会在 Windows 运行，尚未执行远程工作流。
- Mac 外部输入需要本人授予辅助功能权限，再进行真实目标验证。构建成功和逻辑检查不代表外部输入兼容性已通过。

| 目标 | 验证状态 |
| --- | --- |
| macOS TextEdit / Terminal | 未验证真实投递，需辅助功能授权 |
| macOS iTerm2 / 其他自绘输入区 | 未验证；无法识别输入控件时拒绝绑定 |
| Windows Edit / RichEdit | 已实现后台投递，未在 Windows 实机验证 |
| Windows Terminal / CMD / PuTTY | 已实现具体控件识别和焦点校验，未验证 |
| MobaXterm / SecureCRT / 串口助手 | 未验证，不承诺自绘及管理员窗口兼容 |

建议先绑定空白文本框，验证单条、A/B/C 两轮、持续循环、暂停/继续/停止；再测试关闭目标及切换输入区不会错发，以及编辑保存、取消退出、保存退出。

实现参考：[Microsoft FromPoint](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.frompoint)、[SetFocus](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.setfocus)、[GetGUIThreadInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo)。

