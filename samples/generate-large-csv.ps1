param(
    [ValidateSet("100k", "1m")]
    [string]$Size = "100k",
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$rowCount = if ($Size -eq "1m") { 1000000 } else { 100000 }
if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "sales-$Size.csv"
}

$writer = [System.IO.StreamWriter]::new(
    $OutputPath,
    $false,
    [System.Text.UTF8Encoding]::new($false),
    1048576)

try {
    $writer.WriteLine("Customer,OrderDate,Revenue,Region,IsReturning")
    $startDate = [datetime]::new(2024, 1, 1)
    $customers = @("Northwind", "Contoso", "Fabrikam", "Tailspin Toys", "Adventure Works")
    $regions = @("North", "South", "East", "West")

    for ($index = 1; $index -le $rowCount; $index++) {
        $customer = $customers[($index - 1) % $customers.Length]
        $date = $startDate.AddDays(($index - 1) % 730).ToString("yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
        $revenue = ((($index * 7919) % 250000) / 100).ToString("0.00", [Globalization.CultureInfo]::InvariantCulture)
        $region = $regions[($index - 1) % $regions.Length]
        $returning = if ($index % 2 -eq 0) { "true" } else { "false" }
        $writer.WriteLine("$customer,$date,$revenue,$region,$returning")
    }
}
finally {
    $writer.Dispose()
}

Write-Output "Generated $rowCount rows at $OutputPath"
