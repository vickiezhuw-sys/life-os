<#
Life OS Agent Pool v0.1 - Windows PowerShell 5.1 compatible.
Default: dry-run only. -Execute: three paid API requests (Zhipu, DeepSeek, Zhipu).
No key is written to disk or printed. No Python or proxy library required.
#>
param(
    [string]$Topic = "验证中小App和跨境电商对广告投放数据自动化服务的真实付费需求",
    [switch]$Execute,
    [switch]$DeepSeekOnly,
    [switch]$Resume
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

# Fallback mode when Zhipu is unavailable: keep three sequential roles, use DeepSeek for all.
if ($DeepSeekOnly) {
    foreach ($stage in $Stages) {
        $stage.Provider = "DeepSeek"
        $stage.Model = "deepseek-flash"
        $stage.Url = "https://api.deepseek.com/chat/completions"
        $stage.KeyName = "DEEPSEEK_API_KEY"
        $stage.MaxTokens = 1600
    }
}

function Save-Report([string]$FileName, [string]$State) {
    $header = "# Agent Pool v0.1`r`n`r`n状态：$State`r`n`r`n目标：$Topic`r`n`r`n"
    $header += "> AI生成草案；尚未进行网页搜索或真实客户访谈，请勿视为真实付费需求的证明。`r`n"
    $body = ($Script:Sections -join "`r`n`r`n")
    $target = Join-Path $Root $FileName
    [System.IO.File]::WriteAllText($target, $header + "`r`n" + $body + "`r`n", [System.Text.UTF8Encoding]::new($false))
    return $target
}

if ($Resume -and -not $Execute) {
    throw "-Resume 必须与 -Execute 一起使用（会调用未完成阶段的模型API）。"
}

function Invoke-JsonUtf8([string]$Uri, [string]$ApiKey, [byte[]]$Data) {
    # Use the same .NET HTTP stack as PowerShell 5.1, but decode the JSON body as UTF-8 explicitly.
    $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Uri)
    $request.Method = 'POST'
    $request.ContentType = 'application/json; charset=utf-8'
    $request.Headers[[System.Net.HttpRequestHeader]::Authorization] = 'Bearer ' + $ApiKey
    $request.Timeout = 120000
    $request.ReadWriteTimeout = 120000
    $request.ContentLength = $Data.Length
    $stream = $request.GetRequestStream()
    try { $stream.Write($Data, 0, $Data.Length) } finally { $stream.Dispose() }
    $httpResponse = [System.Net.HttpWebResponse]$request.GetResponse()
    try {
        $reader = [System.IO.StreamReader]::new($httpResponse.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try { $responseText = $reader.ReadToEnd() } finally { $reader.Dispose() }
        return ConvertFrom-Json -InputObject $responseText
    } finally { $httpResponse.Dispose() }
}
if (-not $Execute) {
    foreach ($step in $Stages) {
        $Script:Sections += "## $($step.Name) ($($step.Provider))`r`n`r`n计划：$($step.Task)"
    }
    $preview = Save-Report "report.preview.md" "预演：没有API请求"
    Write-Host "预演完成（无API费用）：$preview"
    exit 0
}

if (-not $env:DEEPSEEK_API_KEY -or ((-not $DeepSeekOnly) -and (-not $env:ZHIPU_API_KEY))) {
    Write-Host "未配置当前模式所需的API密钥。DeepSeekOnly模式只需要DEEPSEEK_API_KEY。不要在聊天中发送密钥。"
    exit 1
}

# Load completed phases from prior checkpoint, so already-finished API calls are not repeated.
if ($Resume) {
    $checkpoint = Join-Path $Root "report.partial.md"
    if (-not (Test-Path $checkpoint)) {
        throw "找不到 report.partial.md；不能恢复，请先确认当前脚本所在目录。"
    }
    $previous = [System.IO.File]::ReadAllText($checkpoint, [System.Text.Encoding]::UTF8)
    if (-not $previous.Contains("目标：$Topic")) {
        throw "checkpoint任务与当前Topic不一致，停止以防误用旧结果。"
    }
    $hits = [regex]::Matches($previous, '(?m)^## (Research|Analyst|Reviewer) \((Zhipu|DeepSeek)\)')
    if ($hits.Count -eq 0 -or $hits.Count -ge $Stages.Count) {
        throw "checkpoint没有可恢复的阶段，或已经全部完成。"
    }
    for ($i = 0; $i -lt $hits.Count; $i++) {
        $match = $hits[$i]
        $expected = $Stages[$i]
        if ($match.Groups[1].Value -ne $expected.Name -or $match.Groups[2].Value -ne $expected.Provider) {
            throw "checkpoint中的步骤或厂商与脚本不一致，停止以免误用。"
        }
        $end = if ($i + 1 -lt $hits.Count) { $hits[$i + 1].Index } else { $previous.Length }
        $section = $previous.Substring($match.Index, $end - $match.Index).Trim()
        if ($section.Length -lt 30) { throw "checkpoint内容不完整，停止恢复。" }
        $Script:Sections += $section
    }
    Write-Host "恢复成功：已读入 $($Script:Sections.Count) 个完成阶段，本次不会重复调用。"
}

for ($stepIndex = 0; $stepIndex -lt $Stages.Count; $stepIndex++) {
    $step = $Stages[$stepIndex]
    if ($stepIndex -lt $Script:Sections.Count) {
        Write-Host "跳过已完成的阶段：$($step.Name) ($($step.Provider))"
        continue
    }
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
        $response = Invoke-JsonUtf8 -Uri $step.Url -ApiKey $key -Data ([System.Text.Encoding]::UTF8.GetBytes($json))
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
