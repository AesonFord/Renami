; Explorer context menu for folders and for the background of an open folder. Written under
; HKCU so no elevation is needed, and removed again by the uninstaller.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\Renami" "" "Rename with Renami"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Renami" "Icon" "$INSTDIR\Renami.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Renami\command" "" '"$INSTDIR\Renami.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Renami" "" "Rename with Renami"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Renami" "Icon" "$INSTDIR\Renami.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Renami\command" "" '"$INSTDIR\Renami.exe" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Renami"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Renami"
!macroend
