#requires -Version 5.1
<#
.SYNOPSIS
    生成 android/release.jks 和 android/keystore.properties。

.DESCRIPTION
    - RSA 4096，有效期 10000 天，alias 固定为 chugao。
    - 密码通过 Read-Host -AsSecureString 交互输入，不写进命令行历史。
    - PKCS12 要求 key 密码与 store 密码一致，因此两个字段写同一个值。
    - 脚本会把密码短暂传给 keytool 进程（-storepass/-keypass），这是 keytool 的固有行为。

.NOTES
    release.jks 与 keystore.properties 都已在 android/.gitignore 中忽略，切勿提交。
#>
[CmdletBinding()]
param(
    [string]$Alias = "chugao",
    [int]$KeySize = 4096,
    [int]$ValidityDays = 10000
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$androidDir = Split-Path -Parent $scriptDir
$keystorePath = Join-Path $androidDir "release.jks"
$propertiesPath = Join-Path $androidDir "keystore.properties"

if (Test-Path $keystorePath) {
    throw "已存在 $keystorePath。请先备份并移走该文件，再重新运行本脚本。"
}

$keytool = if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\keytool.exe"))) {
    Join-Path $env:JAVA_HOME "bin\keytool.exe"
}
else {
    "keytool"
}

function Read-PlainPassword {
    param([string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function ConvertTo-PropertiesValue {
    # java.util.Properties 用 ISO-8859-1 读取，非 ASCII 需转成 \uXXXX
    param([string]$Value)
    $builder = New-Object System.Text.StringBuilder
    foreach ($ch in $Value.ToCharArray()) {
        switch ($ch) {
            '\' { [void]$builder.Append('\\') }
            ':' { [void]$builder.Append('\:') }
            '=' { [void]$builder.Append('\=') }
            '#' { [void]$builder.Append('\#') }
            '!' { [void]$builder.Append('\!') }
            ' ' { [void]$builder.Append('\ ') }
            default {
                $code = [int][char]$ch
                if ($code -lt 32 -or $code -gt 126) {
                    [void]$builder.Append('\u' + $code.ToString('x4'))
                }
                else {
                    [void]$builder.Append($ch)
                }
            }
        }
    }
    return $builder.ToString()
}

$password = Read-PlainPassword "请输入 release keystore 密码"
if ([string]::IsNullOrEmpty($password)) {
    throw "密码不能为空。"
}
$confirm = Read-PlainPassword "请再次输入密码"
if ($password -ne $confirm) {
    throw "两次输入的密码不一致。"
}

$dname = "CN=Chugao Studio, OU=Android, O=Chugao Studio, L=Shanghai, ST=Shanghai, C=CN"

& $keytool -genkeypair -v `
    -keystore $keystorePath `
    -alias $Alias `
    -keyalg RSA `
    -keysize $KeySize `
    -sigalg SHA256withRSA `
    -validity $ValidityDays `
    -storetype PKCS12 `
    -storepass $password `
    -keypass $password `
    -dname $dname

if ($LASTEXITCODE -ne 0) {
    throw "keytool 执行失败，退出码 $LASTEXITCODE。"
}

$lines = @(
    "# 由 android/scripts/create-keystore.ps1 生成，请勿提交到版本库"
    "storeFile=release.jks"
    "storePassword=$(ConvertTo-PropertiesValue $password)"
    "keyAlias=$Alias"
    "keyPassword=$(ConvertTo-PropertiesValue $password)"
)
$content = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText($propertiesPath, $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "已生成：" -ForegroundColor Green
Write-Host "  $keystorePath"
Write-Host "  $propertiesPath"
Write-Host ""
Write-Host "证书指纹：" -ForegroundColor Green
& $keytool -list -v -keystore $keystorePath -alias $Alias -storepass $password |
    Select-String -Pattern "SHA256:|SHA1:|Owner:|Valid from"
