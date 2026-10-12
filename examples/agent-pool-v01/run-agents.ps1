<#
Life OS Agent Pool v0.1 - Windows PowerShell 5.1 compatible.
Default: dry-run only. -Execute: three paid API requests (Zhipu, DeepSeek, Zhipu).
No key is written to disk or printed. No Python or proxy library required.
#>
param(
    [string]$Topic = "验证中小App和跨境电商对广告投放数据自动化服务的真实付费需求",
    [switch]$Execute
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:Sections = @()
$Stages = @(
    [pscustomobject]@{
        Name = "Research"; Provider = "Zhipu"; Model = "glm-5.3-flash"
        Url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        KeyName = "ZHIPU_API_KEY"; MaxTokens = 2400
        Task = "列出三类最可能付费的客户及痛点，并列出需验证的证据。只能给假设，不得虚构访谈、来源或成交。中文不超过350字。"
    },
    [pscustomobject]@{
        Name = "Analyst"; Provider = "DeepSeek"; Model = "deepseek-flash"
        Url = "https://api.deepseek.com/chat/completions"
        KeyName = "DEEPSEEK_API_KEY"; MaxTokens = 1200
        Task = "利用Research输出制定七天内低成本验证计划，包含客户接触渠道、访谈问题、成功和停止条件。中文不超过350字。"
    },
    [pscustomobject]@{
        Name = "Reviewer"; Provider = "Zhipu"; Model = "glm-5.3-flash"
        Url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        KeyName = "ZHIPU_API_KEY"; MaxTokens = 2400
        Task = "审核前两步的逻辑与证据缺口，指出最严重的三处风险，并提出唯一优先下一步。中文不超过350字。"
    }
)

function Save-Report([string]$FileName, [string]$State) {
    $header = "# Agent Pool v0.1`r`n`r`n状态：$State`r`n`r`n目标：$Topic`r`n`r`n"
    $header += "> AI生成草案；尚未进行网页搜索或真实客户访谈，请勿视为真实付费需求的证明。`r`n"
    $body = ($Script:Sections -join "`r`n`r`n")
    $target = Join-Path $Root $FileName
    [System.IO.File]::WriteAllText($target, $header + "`r`n" + $body + "`r`n", [System.Text.UTF8Encoding]::new($false))
    return $target
}

if (-not $Execute) {
    foreach ($step in $Stages) {
        $Script:Sections += "## $($step.Name) ($($step.Provider))`r`n`r`n计划：$($step.Task)"
    }
    $preview = Save-Report "report.preview.md" "预演：没有API请求"
    Write-Host "预演完成（无API费用）：$preview"
    exit 0
}

if (-not $env:ZHIPU_API_KEY -or -not $env:DEEPSEEK_API_KEY) {
    Write-Host "请先在当前PowerShell窗口设置ZHIPU_API_KEY和DEEPSEEK_API_KEY，不要把密钥发到聊天。"
    exit 1
}

foreach ($step in $Stages) {
    Write-Host "正在运行 $($step.Name) ($($step.Provider))..."
    $key = [Environment]::GetEnvironmentVariable($step.KeyName)
    $messages = @(
        @{ role = "system"; content = "你是$($step.Name) Agent。$($step.Task) 必须清楚区分事实与假设。" }
        @{ role = "user"; content = "用户目标：$Topic`n`n已完成阶段：`n$($Script:Sections -join "`n`n")" }
    )
    $payload = @{
        model = $step.Model
        messages = $messages
        max_tokens = $step.MaxTokens
        stream = $false
    }
    if ($step.Provider -eq "DeepSeek") {
        $payload.thinking = @{ type = "disabled" }
    }
    $json = ConvertTo-Json -InputObject $payload -Depth 10
    $headers = @{ Authorization = "Bearer $key" }
    try {
        $response = Invoke-RestMethod -Uri $step.Url -Method Post -Headers $headers `
            -ContentType "application/json; charset=utf-8" `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 120
        if (-not $response.choices -or -not $response.choices[0].message.content) {
            throw "响应不包含正文；结束原因：$($response.choices[0].finish_reason)"
        }
        $reply = [string]$response.choices[0].message.content
        $reason = [string]$response.choices[0].finish_reason
        if ($reason -eq "length") {
            throw "模型输出达到max_tokens且可能被截断。"
        }
        $Script:Sections += "## $($step.Name) ($($step.Provider))`r`n`r`n$reply"
        $partial = Save-Report "report.partial.md" "进行中，已完成$($Script:Sections.Count)/3"
        Write-Host "$($step.Name) 完成；阶段结果已保存。"
    }
    catch {
        $partial = Save-Report "report.partial.md" "中断，已完成$($Script:Sections.Count)/3"
        Write-Host "失败阶段：$($step.Name)；错误：$($_.Exception.Message)"
        Write-Host "已完成阶段保存在：$partial"
        exit 1
    }
}

$final = Save-Report "report.md" "完成：全部三个Agent执行成功"
Write-Host "执行完成：$final"
