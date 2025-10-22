#!/usr/bin/env pwsh

Write-Host "Starting Image Viewer Pro..." -ForegroundColor Green

# Check if virtual environment exists
if (Test-Path ".venv\Scripts\Activate.ps1") {
    Write-Host "Activating virtual environment..." -ForegroundColor Yellow
    & .\.venv\Scripts\Activate.ps1
} elseif (Test-Path ".venv\bin\activate") {
    Write-Host "Activating virtual environment..." -ForegroundColor Yellow
    & .\.venv\bin\activate
} else {
    Write-Host "No virtual environment found. Using system Python." -ForegroundColor Yellow
}

# Start the application
npm start