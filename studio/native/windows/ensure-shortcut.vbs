Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count < 1 Then WScript.Quit 1
root = WScript.Arguments(0)
If Right(root, 1) <> "\" Then root = root & "\"
desktop = sh.SpecialFolders("Desktop") & "\来处.lnk"
If fso.FileExists(desktop) Then
  WScript.Echo "Desktop already has a 来处 shortcut. It was left unchanged."
  WScript.Quit 0
End If
Set link = sh.CreateShortcut(desktop)
link.TargetPath = root & "启动来处.cmd"
link.WorkingDirectory = root
link.WindowStyle = 7
link.IconLocation = root & "app\studio\desktop-assets\field.ico"
link.Description = "来处"
link.Save
WScript.Echo "A 来处 shortcut was added to the desktop."
