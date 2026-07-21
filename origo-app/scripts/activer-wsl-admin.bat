@echo off
:: Activer WSL2 pour Docker Desktop — cliquer droit → Exécuter en tant qu'administrateur
echo ========================================
echo  Activation WSL2 pour Docker
echo ========================================
echo.

dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
echo.
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
echo.

echo Resultat:
powershell -NoProfile -Command "Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux,VirtualMachinePlatform | Format-Table FeatureName, State -AutoSize"

echo.
echo IMPORTANT: redemarre le PC apres cette fenetre.
echo Puis ouvre Docker Desktop.
echo.
pause
