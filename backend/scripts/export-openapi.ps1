param(
    [string]$ApiUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
$outputPath = Join-Path $PSScriptRoot "..\openapi.json"
$openApiUrl = "$($ApiUrl.TrimEnd('/'))/swagger/v1/swagger.json"

Invoke-WebRequest -Uri $openApiUrl -OutFile $outputPath
Write-Output "OpenAPI document saved to $outputPath"
