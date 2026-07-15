@echo off
echo ===================================
echo  MegaFon Analysis Server (Python)
echo ===================================
echo.
echo Installing dependencies...
pip install -r requirements.txt -q 2>nul
echo.
echo Starting server on http://localhost:3001
echo.
python app.py
pause
