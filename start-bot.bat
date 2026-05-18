@echo off
cd /d "%~dp0"
title Bundle Tracker - Bot Discord
if not exist ".env" (
  echo.
  echo  Fichier .env manquant !
  echo  1. Copie .env.example vers .env
  echo  2. Remplis DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, etc.
  echo.
  pause
  exit /b 1
)
echo Demarrage du bot Discord...
echo Laisse cette fenetre ouverte pour recevoir les alertes.
echo.
call npm run discord
pause
