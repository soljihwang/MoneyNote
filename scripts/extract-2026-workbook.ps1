param(
  [Parameter(Mandatory = $true)]
  [string]$WorkbookPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ZipText {
  param(
    [Parameter(Mandatory = $true)] [System.IO.Compression.ZipArchive]$Zip,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  $entry = $Zip.GetEntry($Name)
  if (-not $entry) { return $null }

  $reader = New-Object System.IO.StreamReader($entry.Open())
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

function Get-SharedStrings {
  param([System.IO.Compression.ZipArchive]$Zip)

  $text = Get-ZipText -Zip $Zip -Name 'xl/sharedStrings.xml'
  if (-not $text) { return @() }

  [xml]$xml = $text
  $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

  $items = @()
  foreach ($node in $xml.SelectNodes('//x:sst/x:si', $ns)) {
    $items += $node.InnerText
  }
  return $items
}

function Get-SheetMap {
  param([System.IO.Compression.ZipArchive]$Zip)

  [xml]$wbXml = Get-ZipText -Zip $Zip -Name 'xl/workbook.xml'
  [xml]$relXml = Get-ZipText -Zip $Zip -Name 'xl/_rels/workbook.xml.rels'

  $wbNs = New-Object System.Xml.XmlNamespaceManager($wbXml.NameTable)
  $wbNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

  $relNs = New-Object System.Xml.XmlNamespaceManager($relXml.NameTable)
  $relNs.AddNamespace('r', 'http://schemas.openxmlformats.org/package/2006/relationships')

  $relMap = @{}
  foreach ($rel in $relXml.SelectNodes('//r:Relationship', $relNs)) {
    $relMap[$rel.GetAttribute('Id')] = $rel.GetAttribute('Target')
  }

  $sheets = @()
  foreach ($sheet in $wbXml.SelectNodes('//x:sheets/x:sheet', $wbNs)) {
    $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = $relMap[$rid]
    $sheets += [pscustomobject]@{
      name = $sheet.GetAttribute('name')
      target = if ($target) { 'xl/' + $target.TrimStart('/') } else { '' }
    }
  }

  return $sheets
}

function Get-CellValue {
  param(
    [Parameter(Mandatory = $true)] $Cell,
    [Parameter(Mandatory = $true)] [string[]]$SharedStrings
  )

  $typeProp = $Cell.PSObject.Properties['t']
  $type = if ($typeProp) { [string]$typeProp.Value } else { '' }

  if ($type -eq 'inlineStr') {
    $inlineProp = $Cell.PSObject.Properties['is']
    return if ($inlineProp) { [string]$inlineProp.Value.InnerText } else { '' }
  }

  $valueProp = $Cell.PSObject.Properties['v']
  $value = if ($valueProp) { [string]$valueProp.Value } else { '' }

  if ($type -eq 's' -and $value -match '^\d+$') {
    return $SharedStrings[[int]$value]
  }

  return $value
}

function Get-SheetRows {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$SheetTarget,
    [string[]]$SharedStrings
  )

  [xml]$sheetXml = Get-ZipText -Zip $Zip -Name $SheetTarget
  $ns = New-Object System.Xml.XmlNamespaceManager($sheetXml.NameTable)
  $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

  $rows = @()
  foreach ($row in $sheetXml.SelectNodes('//x:worksheet/x:sheetData/x:row', $ns)) {
    $cells = [ordered]@{}
    foreach ($cell in $row.SelectNodes('./x:c', $ns)) {
      $ref = [string]$cell.r
      $col = [regex]::Match($ref, '^[A-Z]+').Value
      $cells[$col] = Get-CellValue -Cell $cell -SharedStrings $SharedStrings
    }

    $rows += [pscustomobject]@{
      row = [int]$row.r
      cells = $cells
    }
  }

  return $rows
}

$resolvedPath = Resolve-Path $WorkbookPath
$zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)

try {
  $sharedStrings = Get-SharedStrings -Zip $zip
  $sheetMap = Get-SheetMap -Zip $zip

  $result = [ordered]@{
    workbookPath = [string]$resolvedPath
    sheets = @()
  }

  foreach ($sheet in $sheetMap) {
    $result.sheets += [pscustomobject]@{
      name = $sheet.name
      rows = Get-SheetRows -Zip $zip -SheetTarget $sheet.target -SharedStrings $sharedStrings
    }
  }

  $result | ConvertTo-Json -Depth 100
} finally {
  $zip.Dispose()
}
