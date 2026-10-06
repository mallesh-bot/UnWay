@echo off
title UnWay bus simulator
cd /d "%~dp0\.."
echo Pretends to be a bus phone: drives the route, scans every child, finishes the trip.
echo Get the code from the dashboard: Buses ^& crew - Pair phone (the 8-letter code under the QR).
echo.
set /p CODE=Pairing code: 
node scripts\simulate-bus.mjs https://zystjqgdriojyjspbcxq.supabase.co eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5c3RqcWdkcmlvanlqc3BiY3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NjEzODEsImV4cCI6MjEwNjUzNzM4MX0.p1pfjfUdLt9nspLo4wux-dnjris2mkuRZAFUJ8JvtIo %CODE%
pause
