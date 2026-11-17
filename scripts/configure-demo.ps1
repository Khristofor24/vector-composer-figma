$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectPath '.env.local'
Write-Host 'Введите отдельный временный ключ OpenRouter. Ввод скрыт; ключ в чат не отправляйте.'
$secureKey = Read-Host 'OPENROUTER_API_KEY' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $demoKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($demoKey) -or $demoKey.Contains("`n") -or $demoKey.Contains("`r")) { throw 'Ключ не введён или содержит перенос строки.' }
    $content = "OPENROUTER_API_KEY=$demoKey`nOPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free`n"
    [IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
    Write-Host 'Локальная конфигурация записана. Выполните npm run package:demo. Ключ отзовите вручную в OpenRouter после проверки работодателем.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $demoKey = $null
    $content = $null
    $secureKey.Dispose()
}
