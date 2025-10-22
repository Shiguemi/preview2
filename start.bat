@echo off
echo Starting Image Viewer Pro...

REM Check if virtual environment exists
if exist ".venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call .venv\Scripts\activate.bat
) else (
    echo No virtual environment found. Using system Python.
)

REM Start the application
npm start

pause