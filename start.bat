@echo off
echo ===================================
echo  MegaFon Analysis Server (Python)
echo ===================================
echo.
echo Installing dependencies...
pip install -r requirements.txt -q 2>nul
echo.
echo Initializing database...
python init_db.py
echo.
echo Starting server on http://localhost:3001
echo PostgreSQL: 127.0.0.1:5434
echo Database: megafon
echo.
python app.py
pause
