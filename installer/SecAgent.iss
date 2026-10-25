#ifndef AppVersion
  #define AppVersion "0.1.1"
#endif

#ifndef SourceDir
  #define SourceDir "..\release\win-unpacked"
#endif

#ifndef OutputDir
  #define OutputDir "..\release\inno"
#endif

#ifndef OutputBaseFilename
  #define OutputBaseFilename "SecAgent-Setup"
#endif

#ifndef ManifestFile
  #define ManifestFile "..\release\SecAgent.files.sha256"
#endif

; Pass /DUiTestBuild to compile a fast, non-invasive UI test build: separate
; AppId, per-user install. Used for visual iteration without touching a real
; installation.
#ifdef UiTestBuild
  #define AppIdSuffix "-UiTest"
#else
  #define AppIdSuffix ""
#endif

[Setup]
AppId={{cn.sectl.secagent{#AppIdSuffix}}
AppName=SecAgent
AppVersion={#AppVersion}
AppPublisher=SECTL
DefaultGroupName=SecAgent
UninstallDisplayIcon={app}\SecAgent.exe
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2
SolidCompression=no
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
DisableWelcomePage=yes
; The directory page IS the main page of the custom UI below. The directive
; defaults to "auto", which skips the page whenever a previous installation
; is detected (upgrades) - that would strand the wizard on the hidden Ready
; page with an empty body. Force it to always show; UsePreviousAppDir still
; prefills DirEdit with the previous install location.
DisableDirPage=no
Uninstallable=yes
; 升级时 SecAgent 大概率正在运行：默认自动关闭锁文件进程并在安装后
; 自动重启它（Restart Manager）。用户仍可在 Preparing 页改选。
CloseApplications=yes
CloseApplicationsFilter=SecAgent.exe
RestartApplications=yes
SetupIconFile=..\resources\icon.ico
#ifdef UiTestBuild
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\SecAgentUiTest
#else
PrivilegesRequired=admin
DefaultDirName={autopf}\SecAgent
PrivilegesRequiredOverridesAllowed=dialog
UsePreviousPrivileges=no
#endif

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "SecAgent"; ValueData: """{app}\SecAgent.exe"" --autostart"; Flags: uninsdeletevalue; Check: AutoStartWanted

[UninstallDelete]
Type: files; Name: "{app}\SecAgent.files.sha256"
Type: files; Name: "{app}\SecAgent.files.sha256.new"

[Files]
Source: "assets\*.png"; Flags: dontcopy
Source: "{#ManifestFile}"; DestName: "SecAgent.files.sha256"; Flags: dontcopy noencryption
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs replacesameversion; Check: ShouldInstallFile

[Icons]
Name: "{autoprograms}\SecAgent"; Filename: "{app}\SecAgent.exe"; Check: StartMenuWanted
Name: "{autodesktop}\SecAgent"; Filename: "{app}\SecAgent.exe"; Check: DesktopWanted

[Run]
Filename: "{app}\SecAgent.exe"; Description: "启动 SecAgent"; Flags: nowait postinstall skipifsilent

[Code]
{ ---------------------------------------------------------------------------
  Custom wizard UI, drawn after the "SecAgent 安装界面" Figma reference:
  an 820x629 borderless rounded card with a white 347px header (bare logo
  mark + "SecAgent" wordmark), an #ECECEC body and a centered 218x69
  "安装" pill in #8AABFF. All coordinates are design pixels scaled by
  UI_SCALE_PCT via UiX/UiY AND the system DPI (R62 redo: the old build froze
  the card at one physical size and counter-scaled fonts, which read "random
  sizes" on any 125-150% display and let DPI-scaled stock controls overlap
  custom ones).  At 96 DPI the geometry is pixel-identical to the previous
  build; fonts render at 75% of the old size on purpose — the old build
  passed design px straight into TFont.Size (pt), inflating glyphs by 4/3,
  while UiFontSize now converts design px x scale to true points
  (design x scale x 3/400). On scaled displays everything - card, fonts,
  pills, hit areas - grows proportionally, like a normal DPI-aware app.
  The scale is capped so the card always fits the work area.

  Inno's script engine exposes no mouse-down events (PS_MINIVCL build), so
  the borderless window is dragged via a WH_MOUSE_LL hook: press on the
  header grabs the card, moving moves it, releasing drops it - the normal
  title-bar interaction.
--------------------------------------------------------------------------- }
const
  UI_WIDTH = 820;
  UI_HEIGHT = 629;
  UI_HEADER_HEIGHT = 347;
  UI_MARGIN = 176;
  { Overall scale applied to every design pixel.  1.0 = the Figma card at
    820x629 physical px, which reads oversized on large monitors; 0.8 lands
    near the typical installer proportion.  Tweak this single value to taste. }
  UI_SCALE_PCT = 80;  { percent }
  UI_COLOR_BAND = $ECECEC;
  UI_COLOR_ACCENT = $FFAB8A; // #8AABFF in BGR

var
  HashManifest: TArrayOfString;
  HashManifestLoaded: Boolean;
  InstalledHashManifest: TArrayOfString;
  InstalledHashManifestLoaded: Boolean;

  { option state, replaces the old [Tasks] section }
  WantDesktop: Boolean;
  WantStartMenu: Boolean;
  WantAutoStart: Boolean;

  { always-visible chrome }
  HeaderBand: TNewStaticText;
  LogoImage: TBitmapImage;
  TitleLabel: TNewStaticText;
  CloseLabel: TNewStaticText;
  VersionLabel: TNewStaticText;

  { main (select directory) page }
  InputPill: TBitmapImage;
  PathLabel: TNewStaticText;
  BrowseButton: TBitmapButton;
  DesktopCheck: TNewCheckBox;
  StartMenuCheck: TNewCheckBox;
  AutoStartCheck: TNewCheckBox;
  InstallButton: TBitmapButton;

  { installing page }
  ProgressTitle: TNewStaticText;
  ProgressPercentLabel: TNewStaticText;
  ProgressTrackImage: TBitmapImage;
  ProgressFillImage: TBitmapImage;
  ProgressFillFullShown: Boolean;

  { finished page }
  FinishTitle: TNewStaticText;
  FinishSubtitle: TNewStaticText;
  FinishButton: TBitmapButton;

function CreateRoundRectRgn(X1, Y1, X2, Y2, X3, Y3: Integer): HWND;
external 'CreateRoundRectRgn@gdi32.dll stdcall';
function SetWindowRgn(hWnd: HWND; hRgn: HWND; bRedraw: Longint): Longint;
external 'SetWindowRgn@user32.dll stdcall';

{ --- small helpers ------------------------------------------------------- }

{ Win32 metrics for the work-area clamp (Inno PS has no Screen/Monitor). }
function GetSystemMetrics(nIndex: Integer): Integer;
  external 'GetSystemMetrics@user32.dll stdcall';

function UiDpiPercent: Integer;
var
  MaxDpi, WaW, WaH: Integer;
begin
  { System DPI in percent-of-96.  ScaleX(96) returns the physical width of a
    96-logical-px rule, i.e. 144 at 150%.  Guard non-scaled runtimes. }
  Result := ScaleX(96);
  if Result < 96 then
    Result := 96;
  { Cap so the scaled card always fits the primary work area with margin:
    UI_WIDTH * UI_SCALE_PCT * dpi / 9600 <= WorkAreaWidth - 80. }
  { Inno Pascal Script exposes neither the VCL Screen global nor
    WizardForm.Monitor.  Win32 GetSystemMetrics(SM_CXFULLSCREEN=16 /
    SM_CYFULLSCREEN=17) gives the primary-monitor work area (taskbar and
    appbars excluded) in physical pixels - the same units UiX produces,
    since the Inno wizard itself is DPI-aware. }
  try
    WaW := GetSystemMetrics(16);
    WaH := GetSystemMetrics(17);
    if (WaW > 0) and (WaH > 0) then begin
      MaxDpi := (WaW - 80) * 9600 div (UI_WIDTH * UI_SCALE_PCT);
      if MaxDpi < 96 then
        MaxDpi := 96;
      if Result > MaxDpi then
        Result := MaxDpi;
    end;
  except
    { Metrics unavailable - keep the raw DPI }
  end;
end;

function UiX(Value: Integer): Integer;
begin
  { Design pixels -> physical pixels: design scale x system DPI (R62 redo -
    proportional on every display; at 96 dpi identical to the old fixed build). }
  Result := Value * UI_SCALE_PCT * UiDpiPercent div 9600;
end;

function UiY(Value: Integer): Integer;
begin
  Result := Value * UI_SCALE_PCT * UiDpiPercent div 9600;
end;

function UiFontSize(DesignSize: Integer): Integer;
begin
  { TFont.Size is in points, and 1 pt renders DPI-physically (pt x dpi/72 px).
    Geometry scales as design*scale*dpi/96, so the matching point size is
    DPI-independent: design x scale x 72/96 = design x scale x 3/400.
    Note: this is intentionally 75% of the old build's glyph size at 96 dpi —
    the old code fed design px into TFont.Size as if they were points. }
  Result := DesignSize * UI_SCALE_PCT * 3 div 400;
  if Result < 1 then
    Result := 1;
end;

{ Check: functions for [Icons]/[Registry], reading the snapshot taken when
  installation starts }
function DesktopWanted: Boolean;
begin
  Result := WantDesktop;
end;

function StartMenuWanted: Boolean;
begin
  Result := WantStartMenu;
end;

function AutoStartWanted: Boolean;
begin
  Result := WantAutoStart;
end;

{ The interactive install's [Run] entry launches SecAgent from the elevated
  installer process, so the app starts with the inherited admin token - the
  whole elevated-autostart chain starts here. Silent updates instead relaunch
  through Restart Manager (/RESTARTAPPLICATIONS), which uses the original
  user token; those users get their elevation from the autostart scheduled
  task on the next boot. }

procedure StyleFont(AFont: TFont; ASizePt: Integer; AColor: TColor; ABold: Boolean);
begin
  AFont.Name := 'Microsoft YaHei UI';
  AFont.Size := UiFontSize(ASizePt);
  AFont.Color := AColor;
  if ABold then
    AFont.Style := [fsBold]
  else
    AFont.Style := [];
end;

function MakeLabel(AParent: TWinControl; ALeft, ATop, AWidth, AHeight: Integer;
  const ACaption: String; AColor: TColor): TNewStaticText;
begin
  Result := TNewStaticText.Create(AParent);
  Result.Parent := AParent;
  { TNewStaticText defaults to AutoSize=True, which would clobber the bounds }
  Result.AutoSize := False;
  Result.SetBounds(UiX(ALeft), UiY(ATop), UiX(AWidth), UiY(AHeight));
  Result.Caption := ACaption;
  { labels are opaque (csOpaque); without an explicit color they would paint
    the form's default background over the band }
  Result.Color := AColor;
end;

var
  DragHook: Longword;
  DragTimerID: Longword;
  { R69: wpPreparing 显示后一次性重排定时器（见 RelayoutPreparingPage）。 }
  PreparingFixTimerID: Longword;
  DragActive: Boolean;
  DragOffsetX, DragOffsetY: Integer;

const
  WH_MOUSE_LL = 14;
  WM_LBUTTONDOWN = $0201;
  WM_LBUTTONUP = $0202;

type
  { reserved: kept for clarity of the hook signature; the struct is not
    marshalled because Inno's DLL interface cannot pass records }
  TMSLLHookPoint = record
    X, Y: Longint;
  end;

function GetCursorPos(var Point: TPoint): Longint;
external 'GetCursorPos@user32.dll stdcall';
function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: Longword): Longword;
external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, nIDEvent: Longword): Bool;
external 'KillTimer@user32.dll stdcall';

function SetWindowsHookEx(idHook: Integer; lpfn: Longword; hMod: Longword;
  dwThreadId: Longword): Longword;
external 'SetWindowsHookExW@user32.dll stdcall';
function UnhookWindowsHookEx(hhk: Longword): Bool;
external 'UnhookWindowsHookEx@user32.dll stdcall';
function CallNextHookEx(hhk: Longword; nCode: Integer; wParam: Longword;
  lParam: Longword): Longword;
external 'CallNextHookEx@user32.dll stdcall';

{ Native hold-to-drag for the borderless window.  Inno's script runtime has
  no OnMouseDown, so the wizard never sees the press that should start a
  caption drag.  A WH_MOUSE_LL hook restores the normal interaction: press on
  the header grabs the card, moving the cursor moves the window, releasing
  the button drops it - exactly like a native title bar.  The event position
  is read with GetCursorPos: during a low-level hook callback the cursor is
  already at the event point, which avoids marshalling PTMouseHookStruct
  (Inno's DLL interface cannot pass records). }
{ The hook must stay extremely fast - doing window moves inside a
  low-level hook callback trips the system hook timeout and the hook is
  silently removed after the first event.  So the hook only flips flags;
  a 15 ms timer applies the actual window moves. }
function MouseHookProc(nCode: Integer; wParam: Longword;
  lParam: Longword): Longword;
var
  Pt: TPoint;
begin
  Result := 0;
  try
    if nCode >= 0 then begin
      if wParam = WM_LBUTTONDOWN then begin
        GetCursorPos(Pt);
        { grab only when the press lands on the header band (screen coords),
          excluding the close button's design rect (760,8)-(816,64) so a
          sloppy click on the X never drags the window }
        if (Pt.Y >= WizardForm.Top) and
           (Pt.Y < WizardForm.Top + UiY(UI_HEADER_HEIGHT)) and
           (Pt.X >= WizardForm.Left) and
           (Pt.X < WizardForm.Left + UiX(UI_WIDTH)) and
           not ((Pt.X >= WizardForm.Left + UiX(760)) and
                (Pt.X < WizardForm.Left + UiX(816)) and
                (Pt.Y >= WizardForm.Top + UiY(8)) and
                (Pt.Y < WizardForm.Top + UiY(64))) then begin
          DragActive := True;
          DragOffsetX := Pt.X - WizardForm.Left;
          DragOffsetY := Pt.Y - WizardForm.Top;
        end else
          DragActive := False;
      end else if wParam = WM_LBUTTONUP then
        DragActive := False;
    end;
  except
    { never raise inside a system hook }
    DragActive := False;
  end;
  { low-level hooks MUST pass every event down the chain or mouse input
    system-wide stalls }
  Result := CallNextHookEx(DragHook, nCode, wParam, lParam);
end;

{ timer body: while the hook says a drag is active, track the cursor }
procedure DragTimerProc(Arg1, Arg2, Arg3, Arg4: Longword);
var
  Pt: TPoint;
begin
  try
    if DragActive then begin
      GetCursorPos(Pt);
      WizardForm.Left := Pt.X - DragOffsetX;
      WizardForm.Top := Pt.Y - DragOffsetY;
    end;
  except
    DragActive := False;
  end;
end;

procedure InstallDragHook;
begin
  if DragHook = 0 then
    DragHook := SetWindowsHookEx(WH_MOUSE_LL, CreateCallback(@MouseHookProc),
      0, 0);
  DragTimerID := SetTimer(0, 0, 15, CreateCallback(@DragTimerProc));
end;

procedure RemoveDragHook;
begin
  DragActive := False;
  if DragHook <> 0 then begin
    UnhookWindowsHookEx(DragHook);
    DragHook := 0;
  end;
  if DragTimerID <> 0 then begin
    KillTimer(0, DragTimerID);
    DragTimerID := 0;
  end;
end;

procedure CloseLabelClick(Sender: TObject);
begin
  { The stock cancel path (TMainForm.Close) refuses to run while CancelButton
    is hidden - it gates on CancelButton.CanFocus.  CurPageChanged hides the
    button on this page, so briefly reveal it for the click, then restore. }
  WizardForm.CancelButton.Visible := True;
  try
    WizardForm.CancelButton.OnClick(WizardForm.CancelButton);
  finally
    WizardForm.CancelButton.Visible := False;
  end;
end;

procedure BrowseButtonClick(Sender: TObject);
begin
  WizardForm.DirBrowseButton.OnClick(WizardForm.DirBrowseButton);
end;

procedure PrimaryButtonClick(Sender: TObject);
begin
  WizardForm.NextButton.OnClick(WizardForm.NextButton);
end;

{ --- window chrome ------------------------------------------------------- }

procedure ApplyWindowChrome;
var
  Region: HWND;
begin
  WizardForm.BorderStyle := bsNone;
  WizardForm.Caption := 'SecAgent 安装';
  WizardForm.Color := UI_COLOR_BAND;
  WizardForm.Position := poScreenCenter;
  WizardForm.ClientWidth := UiX(UI_WIDTH);
  WizardForm.ClientHeight := UiY(UI_HEIGHT);
  { rounded card corners (42px in the design) }
  Region := CreateRoundRectRgn(0, 0, WizardForm.ClientWidth + 1,
    WizardForm.ClientHeight + 1, UiX(42), UiY(42));
  SetWindowRgn(WizardForm.Handle, Region, 1);
end;

procedure HideStandardChrome;
begin
  { NOTE: the stock navigation buttons are deliberately NOT hidden here.
    After InitializeWizard, Inno runs ClickToStartPage, which walks past
    skipped pages by clicking NextButton - and that requires the button to
    still be visible and focusable. Hiding them here would strand the wizard
    on the welcome page. They are hidden per-page in CurPageChanged instead. }
  WizardForm.Bevel.Visible := False;
  WizardForm.Bevel1.Visible := False;
  WizardForm.MainPanel.Visible := False;
  WizardForm.WizardSmallBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage2.Visible := False;
  { full-bleed pages; MainPanel is hidden so InnerNotebook claims its space.
    The stock DFM gives these notebooks and the stock controls inside the
    pages akRight/akBottom anchors. Those anchors carry margins captured at
    form creation, and the VCL align pass that runs when the form is first
    shown re-applies them - reverting every SetBounds done in InitializeWizard
    (observed: InnerNotebook snapping back to the stock 1648x1339 and the
    DirEdit/DiskSpaceLabel stretching with it). Clearing the anchors to
    left/top pins each control to the bounds we set here. }
  WizardForm.OuterNotebook.Anchors := [akLeft, akTop];
  WizardForm.InnerNotebook.Anchors := [akLeft, akTop];
  WizardForm.OuterNotebook.SetBounds(0, 0, UiX(UI_WIDTH), UiY(UI_HEIGHT));
  WizardForm.InnerNotebook.SetBounds(0, 0, UiX(UI_WIDTH), UiY(UI_HEIGHT));

  WizardForm.InnerPage.Color := UI_COLOR_BAND;
  WizardForm.SelectDirPage.Color := UI_COLOR_BAND;
  WizardForm.InstallingPage.Color := UI_COLOR_BAND;
  WizardForm.FinishedPage.Color := UI_COLOR_BAND;
  WizardForm.PreparingPage.Color := UI_COLOR_BAND;
end;

procedure BuildChrome;
begin
  { white header band; doubles as the drag surface for the borderless window.
    The drag itself is handled by the WH_MOUSE_LL hook installed at the end
    of InitializeWizard - these OnClick bindings are only for the cursor. }
  HeaderBand := TNewStaticText.Create(WizardForm);
  HeaderBand.Parent := WizardForm;
  HeaderBand.AutoSize := False;
  HeaderBand.SetBounds(0, 0, UiX(UI_WIDTH), UiY(UI_HEADER_HEIGHT));
  HeaderBand.Caption := ' ';
  HeaderBand.Color := clWhite;
  HeaderBand.Cursor := crDefault;

  { the logo is a TGraphicControl, so it must live inside the windowed band
    to paint above the notebook }
  LogoImage := TBitmapImage.Create(HeaderBand);
  LogoImage.Parent := HeaderBand;
  LogoImage.BackColor := clNone;
  LogoImage.Stretch := True;
  LogoImage.SetBounds(UiX(152), UiY(80), UiX(185), UiY(188));
  LogoImage.PngImage.LoadFromFile(ExpandConstant('{tmp}\logo.png'));
  { NOTE: do NOT cover the logo with a windowed control to change its hover
    cursor - TBitmapImage ignores Cursor in the PS_MINIVCL build anyway, and
    any windowed overlay paints over the bitmap (that is how alpha.25 blanked
    the logo). The whole band keeps the plain arrow; the drag works wherever
    the hook accepts the press. }

  TitleLabel := MakeLabel(HeaderBand, 342, 130, 320, 96, 'SecAgent', clWhite);
  StyleFont(TitleLabel.Font, 48, clBlack, True);
  TitleLabel.Cursor := crDefault;

  CloseLabel := MakeLabel(HeaderBand, 760, 8, 56, 56, '×', clWhite);
  CloseLabel.Alignment := taCenter;
  StyleFont(CloseLabel.Font, 20, $555555, False);
  CloseLabel.Cursor := crHand;
  CloseLabel.OnClick := @CloseLabelClick;

  VersionLabel := MakeLabel(WizardForm, 0, 590, UI_WIDTH, 22,
    'SecAgent v{#AppVersion}', UI_COLOR_BAND);
  VersionLabel.Alignment := taCenter;
  StyleFont(VersionLabel.Font, 8, $999999, False);
end;

{ --- main page (directory selection + options + install button) ---------- }

procedure BuildMainPage;
begin
  WizardForm.SelectDirBrowseLabel.Visible := False;
  WizardForm.SelectDirLabel.Visible := False;
  WizardForm.SelectDirBitmapImage.Visible := False;
  WizardForm.DirBrowseButton.Visible := False;

  { rounded white pill behind the borderless directory edit }
  InputPill := TBitmapImage.Create(WizardForm.SelectDirPage);
  InputPill.Parent := WizardForm.SelectDirPage;
  InputPill.BackColor := clNone;
  InputPill.Stretch := True;
  InputPill.SetBounds(UiX(UI_MARGIN), UiY(396), UiX(368), UiY(34));
  InputPill.PngImage.LoadFromFile(ExpandConstant('{tmp}\input-pill.png'));

  WizardForm.DirEdit.BorderStyle := bsNone;
  WizardForm.DirEdit.Anchors := [akLeft, akTop];
  { a borderless edit paints its text high (the internal margin assumes a
    border); sit it 3px lower in the pill to look centred }
  WizardForm.DirEdit.SetBounds(UiX(UI_MARGIN + 12), UiY(403),
    UiX(344), UiY(26));
  WizardForm.DirEdit.Font.Name := 'Microsoft YaHei UI';
  WizardForm.DirEdit.Font.Size := UiFontSize(14);

  PathLabel := MakeLabel(WizardForm.SelectDirPage, UI_MARGIN, 364, 300, 26,
    '安装路径', UI_COLOR_BAND);
  StyleFont(PathLabel.Font, 14, $555555, False);

  WizardForm.DiskSpaceLabel.Anchors := [akLeft, akTop];
  WizardForm.DiskSpaceLabel.SetBounds(UiX(UI_MARGIN), UiY(437),
    UiX(420), UiY(17));
  WizardForm.DiskSpaceLabel.Color := UI_COLOR_BAND;
  WizardForm.DiskSpaceLabel.Font.Color := $999999;
  WizardForm.DiskSpaceLabel.Font.Size := 9;

  { TBitmapButton keeps a 2px focus margin around the image, hence the +/- 2 }
  BrowseButton := TBitmapButton.Create(WizardForm.SelectDirPage);
  BrowseButton.Parent := WizardForm.SelectDirPage;
  BrowseButton.PngImage.LoadFromFile(ExpandConstant('{tmp}\button-browse.png'));
  { Stretch defaults to False, which renders the PNG at its natural size in
    the top-left corner; the button bounds are design pixels, so stretch }
  BrowseButton.Stretch := True;
  BrowseButton.Caption := '浏览';
  BrowseButton.Cursor := crHand;
  BrowseButton.OnClick := @BrowseButtonClick;
  { +2px down: the baked caption reads slightly high inside the outline pill }
  BrowseButton.SetBounds(UiX(552 - 2), UiY(394 - 2 + 2), UiX(88 + 4),
    UiY(34 + 4));

  DesktopCheck := TNewCheckBox.Create(WizardForm.SelectDirPage);
  DesktopCheck.Parent := WizardForm.SelectDirPage;
  DesktopCheck.Caption := '桌面快捷方式';
  DesktopCheck.Checked := True;
  DesktopCheck.Color := UI_COLOR_BAND;
  StyleFont(DesktopCheck.Font, 13, $333333, False);
  DesktopCheck.SetBounds(UiX(176), UiY(458), UiX(160), UiY(28));

  StartMenuCheck := TNewCheckBox.Create(WizardForm.SelectDirPage);
  StartMenuCheck.Parent := WizardForm.SelectDirPage;
  StartMenuCheck.Caption := '开始菜单';
  StartMenuCheck.Checked := True;
  StartMenuCheck.Color := UI_COLOR_BAND;
  StyleFont(StartMenuCheck.Font, 13, $333333, False);
  StartMenuCheck.SetBounds(UiX(324), UiY(458), UiX(140), UiY(28));

  AutoStartCheck := TNewCheckBox.Create(WizardForm.SelectDirPage);
  AutoStartCheck.Parent := WizardForm.SelectDirPage;
  AutoStartCheck.Caption := '开机自动启动';
  { default on: WantAutoStart in InitializeWizard is only the pre-UI default;
    CurStepChanged(ssInstall) snapshots THIS checkbox, so both must agree }
  AutoStartCheck.Checked := True;
  AutoStartCheck.Color := UI_COLOR_BAND;
  StyleFont(AutoStartCheck.Font, 13, $333333, False);
  AutoStartCheck.SetBounds(UiX(458), UiY(458), UiX(170), UiY(28));

  InstallButton := TBitmapButton.Create(WizardForm.SelectDirPage);
  InstallButton.Parent := WizardForm.SelectDirPage;
  InstallButton.PngImage.LoadFromFile(
    ExpandConstant('{tmp}\button-primary.png'));
  InstallButton.Stretch := True;
  InstallButton.Caption := '安装';
  InstallButton.Cursor := crHand;
  InstallButton.OnClick := @PrimaryButtonClick;
  InstallButton.SetBounds(UiX(301 - 2), UiY(506 - 2), UiX(218 + 4),
    UiY(69 + 4));
end;

{ --- installing page ------------------------------------------------------ }

procedure BuildProgressPage;
begin
  WizardForm.ProgressGauge.Visible := False;

  WizardForm.FilenameLabel.Anchors := [akLeft, akTop];
  WizardForm.FilenameLabel.SetBounds(UiX(UI_MARGIN), UiY(502),
    UiX(468), UiY(20));
  WizardForm.FilenameLabel.Color := UI_COLOR_BAND;
  WizardForm.FilenameLabel.Font.Color := $777777;
  WizardForm.StatusLabel.Anchors := [akLeft, akTop];
  WizardForm.StatusLabel.SetBounds(UiX(UI_MARGIN), UiY(526),
    UiX(468), UiY(20));
  WizardForm.StatusLabel.Color := UI_COLOR_BAND;
  WizardForm.StatusLabel.Font.Color := $999999;

  ProgressTitle := MakeLabel(WizardForm.InstallingPage, UI_MARGIN, 378, 420, 40,
    '正在安装 SecAgent', UI_COLOR_BAND);
  StyleFont(ProgressTitle.Font, 16, $171717, True);

  ProgressPercentLabel := MakeLabel(WizardForm.InstallingPage, 512, 372, 132,
    52, '0%', UI_COLOR_BAND);
  ProgressPercentLabel.Alignment := taRightJustify;
  StyleFont(ProgressPercentLabel.Font, 30, UI_COLOR_ACCENT, True);

  ProgressTrackImage := TBitmapImage.Create(WizardForm.InstallingPage);
  ProgressTrackImage.Parent := WizardForm.InstallingPage;
  ProgressTrackImage.BackColor := clNone;
  ProgressTrackImage.Stretch := True;
  ProgressTrackImage.SetBounds(UiX(UI_MARGIN), UiY(460), UiX(468),
    UiY(14));
  ProgressTrackImage.PngImage.LoadFromFile(
    ExpandConstant('{tmp}\progress-track.png'));

  ProgressFillImage := TBitmapImage.Create(WizardForm.InstallingPage);
  ProgressFillImage.Parent := WizardForm.InstallingPage;
  ProgressFillImage.BackColor := clNone;
  ProgressFillImage.Stretch := True;
  ProgressFillImage.SetBounds(UiX(UI_MARGIN + 3), UiY(463), 1,
    UiY(8));
  ProgressFillImage.Visible := False;
  ProgressFillImage.PngImage.LoadFromFile(
    ExpandConstant('{tmp}\progress-fill.png'));
end;

{ --- finished page -------------------------------------------------------- }

procedure BuildFinishPage;
begin
  WizardForm.FinishedHeadingLabel.Visible := False;
  WizardForm.FinishedLabel.Visible := False;

  { restart-now / restart-later radios (only shown when a restart is needed);
  final positions are re-asserted in CurPageChanged(wpFinished) }
  WizardForm.YesRadio.Anchors := [akLeft, akTop];
  WizardForm.YesRadio.Color := UI_COLOR_BAND;
  StyleFont(WizardForm.YesRadio.Font, 10, $333333, False);
  WizardForm.NoRadio.Anchors := [akLeft, akTop];
  WizardForm.NoRadio.Color := UI_COLOR_BAND;
  StyleFont(WizardForm.NoRadio.Font, 10, $333333, False);

  WizardForm.RunList.BorderStyle := bsNone;
  WizardForm.RunList.Color := UI_COLOR_BAND;
  WizardForm.RunList.Anchors := [akLeft, akTop];
  WizardForm.RunList.SetBounds(UiX(UI_MARGIN), UiY(468), UiX(300),
    UiY(24));

  FinishTitle := MakeLabel(WizardForm.FinishedPage, 0, 372, UI_WIDTH, 58,
    '安装完成', UI_COLOR_BAND);
  FinishTitle.Alignment := taCenter;
  StyleFont(FinishTitle.Font, 27, $171717, True);

  FinishSubtitle := MakeLabel(WizardForm.FinishedPage, 0, 436, UI_WIDTH, 30,
    'SecAgent 已成功安装到您的电脑。', UI_COLOR_BAND);
  FinishSubtitle.Alignment := taCenter;
  StyleFont(FinishSubtitle.Font, 11, $555555, False);

  FinishButton := TBitmapButton.Create(WizardForm.FinishedPage);
  FinishButton.Parent := WizardForm.FinishedPage;
  FinishButton.PngImage.LoadFromFile(
    ExpandConstant('{tmp}\button-finish.png'));
  FinishButton.Stretch := True;
  FinishButton.Caption := '完成';
  FinishButton.Cursor := crHand;
  FinishButton.OnClick := @PrimaryButtonClick;
  FinishButton.SetBounds(UiX(301 - 2), UiY(506 - 2), UiX(218 + 4),
    UiY(69 + 4));
end;

{ --- preparing page (Restart Manager / retry prompts) ---------------------- }

{ R69 修复「关闭进程」页内容下坠 + 按钮被裁：
  实机（DPI 125%，5 个 SecAgent 进程锁定文件）实测——Inno 在本页显示时
  按 stock 相对布局重排：多行列表把两个单选钮一路推到主按钮区以下、
  接近窗口底；NextButton 的 stock akBottom 锚又在后续 VCL 对齐流里把 Top
  从窗底重新推导，最终只露顶部蓝边、文字与可点击主体全被窗口底裁掉
  （用户截图像素级测量：按钮设计位 y506-575，实测蓝边 y611-646）。
  R26 的旧坐标本身还有 radio(494/516) 与按钮(506-575) 区域重叠的问题。

  修法三重钉：建页时（init）、CurPageChanged 时、显示后 120ms 一次性
  定时器（在 Inno 的 show-time 重排与 VCL 锚定流全部落定后）各钉一遍
  设计坐标；NextButton 先摘 akBottom 锚。新坐标紧凑无重叠：
  label 364-400 / memo 404-456(带滚动条) / radio 460-498 / 按钮 506-575。 }
procedure RelayoutPreparingPage;
begin
  WizardForm.PreparingErrorBitmapImage.Anchors := [akLeft, akTop];
  WizardForm.PreparingErrorBitmapImage.SetBounds(UiX(140), UiY(368),
    UiX(32), UiY(32));

  WizardForm.PreparingLabel.AutoSize := False;
  WizardForm.PreparingLabel.Anchors := [akLeft, akTop];
  WizardForm.PreparingLabel.SetBounds(UiX(UI_MARGIN), UiY(364),
    UiX(468), UiY(36));
  WizardForm.PreparingLabel.Color := UI_COLOR_BAND;
  StyleFont(WizardForm.PreparingLabel.Font, 11, $333333, False);

  WizardForm.PreparingMemo.Anchors := [akLeft, akTop];
  { 多条锁定进程时靠滚动条，不再撑高把 radio 推出可视区 }
  WizardForm.PreparingMemo.ScrollBars := ssVertical;
  WizardForm.PreparingMemo.SetBounds(UiX(UI_MARGIN), UiY(404),
    UiX(468), UiY(52));
  WizardForm.PreparingMemo.Color := clWhite;

  WizardForm.PreparingYesRadio.Anchors := [akLeft, akTop];
  WizardForm.PreparingYesRadio.SetBounds(UiX(UI_MARGIN), UiY(460),
    UiX(468), UiY(18));
  WizardForm.PreparingYesRadio.Color := UI_COLOR_BAND;
  StyleFont(WizardForm.PreparingYesRadio.Font, 10, $333333, False);

  WizardForm.PreparingNoRadio.Anchors := [akLeft, akTop];
  WizardForm.PreparingNoRadio.SetBounds(UiX(UI_MARGIN), UiY(480),
    UiX(468), UiY(18));
  WizardForm.PreparingNoRadio.Color := UI_COLOR_BAND;
  StyleFont(WizardForm.PreparingNoRadio.Font, 10, $333333, False);
end;

procedure PreparingFixTimerProc(Arg1, Arg2, Arg3, Arg4: Longword);
begin
  try
    if PreparingFixTimerID <> 0 then begin
      KillTimer(0, PreparingFixTimerID);
      PreparingFixTimerID := 0;
    end;
    RelayoutPreparingPage;
  except
  end;
end;

procedure BuildPreparingPage;
begin
  { R26: 默认勾「是」自动关闭（原默认否→升级死锁在这里像卡死） }
  WizardForm.PreparingYesRadio.Checked := True;
  RelayoutPreparingPage;
end;

{ --- events --------------------------------------------------------------- }

procedure InitializeWizard;
begin
  WantDesktop := True;
  WantStartMenu := True;
  WantAutoStart := True;

  ExtractTemporaryFile('logo.png');
  ExtractTemporaryFile('button-primary.png');
  ExtractTemporaryFile('button-finish.png');
  ExtractTemporaryFile('button-browse.png');
  ExtractTemporaryFile('input-pill.png');
  ExtractTemporaryFile('progress-track.png');
  ExtractTemporaryFile('progress-fill.png');
  ExtractTemporaryFile('progress-fill-full.png');

  WizardForm.Font.Name := 'Microsoft YaHei UI';

  ApplyWindowChrome;
  HideStandardChrome;
  BuildChrome;
  BuildMainPage;
  BuildProgressPage;
  BuildFinishPage;
  BuildPreparingPage;
  InstallDragHook;
end;

procedure DeinitializeSetup;
begin
  if PreparingFixTimerID <> 0 then begin
    KillTimer(0, PreparingFixTimerID);
    PreparingFixTimerID := 0;
  end;
  RemoveDragHook;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  { the options live on the directory page; everything in between is noise.
    wpPreparing is always skipped by the wizard form itself and never
    reaches this function }
  Result := (PageID = wpSelectTasks) or (PageID = wpReady);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  { Hide the stock navigation buttons on every page the custom UI fully
    replaces. SetCurPage re-shows them via UpdateCurPageButtonState on each
    page change, so this must run on every transition. wpWelcome is exempt:
    CurPageChanged(wpWelcome) fires before ClickToStartPage runs, and the
    walk needs a focusable NextButton to leave that page.

    SILENT INSTALLS MUST KEEP THE WALK ALIVE: with /VERYSILENT Inno drives
    the wizard by clicking NextButton (ClickThroughPages); a hidden button
    fails CanFocus, the page never advances and the install silently aborts
    ("Failed to proceed to next wizard page"). So when silent, move the
    buttons off-screen instead of hiding them - they stay focusable but are
    never seen. }
  if WizardSilent then begin
    { keep the buttons focusable but off-screen so Inno's page walk works }
    WizardForm.BackButton.Left := WizardForm.ClientWidth + UiX(400);
    WizardForm.NextButton.Left := WizardForm.ClientWidth + UiX(400);
    WizardForm.CancelButton.Left := WizardForm.ClientWidth + UiX(400);
  end else begin
    case CurPageID of
      wpSelectDir, wpReady, wpInstalling, wpFinished:
        begin
          WizardForm.BackButton.Visible := False;
          WizardForm.NextButton.Visible := False;
          WizardForm.CancelButton.Visible := False;
        end;
      wpPreparing:
        begin
          { R65 修复「关闭进程」页无按钮可点：Preparing 页是 Restart Manager
            的原生确认页（选 是/否 关闭锁定进程 → 点 Next 确认），自定义 UI
            没有为它画替代按钮，此前 NextButton 被一并隐藏 → 用户选完没有任何
            按钮确认，只能 X 掉安装器。现在把 stock NextButton 移到主按钮的
            设计位置、贴中文文案，可见可点；Cancel 同步隐藏（顶栏 × 已可退）。 }
          WizardForm.BackButton.Visible := False;
          WizardForm.CancelButton.Visible := False;
          { R69: stock 的 akBottom 锚会在后续 VCL 对齐流里把 Top 从窗底重新
            推导、覆盖下面的 SetBounds（实测按钮只剩顶部蓝边可点不到）——
            先摘锚再定位。 }
          WizardForm.NextButton.Anchors := [akLeft, akTop];
          WizardForm.NextButton.SetBounds(UiX(301 - 2), UiY(506 - 2),
            UiX(218 + 4), UiY(69 + 4));
          WizardForm.NextButton.Caption := '继续';
          WizardForm.NextButton.Visible := True;
          { R69: Inno 显示本页时的 stock 重排与本事件的先后顺序无保证，
            120ms 一次性定时器在一切落定后再钉一遍（见
            RelayoutPreparingPage 头注释）。 }
          if PreparingFixTimerID <> 0 then
            KillTimer(0, PreparingFixTimerID);
          PreparingFixTimerID := SetTimer(0, 0, 120,
            CreateCallback(@PreparingFixTimerProc));
        end;
    end;
  end;
  if CurPageID = wpFinished then begin
    { When installation completes, Inno repositions RunList relative to the
      (hidden) stock FinishedLabel via ChangeFinishedLabel, which lands it at
      design y452 - right under our full-width FinishSubtitle label, whose
      opaque background then paints over the list's top. Re-assert the design
      position here; this runs after that code and nothing moves the list
      afterwards. The restart radios (shown instead of the run list when a
      restart is needed) are tucked into the same slot. }
    WizardForm.RunList.SetBounds(UiX(UI_MARGIN), UiY(468),
      UiX(300), UiY(24));
    WizardForm.YesRadio.SetBounds(UiX(UI_MARGIN), UiY(462),
      UiX(300), UiY(20));
    WizardForm.NoRadio.SetBounds(UiX(UI_MARGIN), UiY(486),
      UiX(300), UiY(20));
  end;
  { and keep the notebooks full-bleed in case anything re-derived them }
  WizardForm.OuterNotebook.SetBounds(0, 0, UiX(UI_WIDTH), UiY(UI_HEIGHT));
  WizardForm.InnerNotebook.SetBounds(0, 0, UiX(UI_WIDTH), UiY(UI_HEIGHT));
  { SetCurPage brings the active notebook page to the front of the form's
    z-order, which covers the header band - the drag/close surface stops
    receiving clicks after the first page switch.  Re-raise the chrome. }
  if HeaderBand <> nil then
    HeaderBand.BringToFront;
end;

procedure CurInstallProgressChanged(CurrentStep, TotalSteps: Integer);
var
  Pct, FillWidth, TrackInner: Integer;
begin
  if TotalSteps > 0 then
    Pct := CurrentStep * 100 div TotalSteps
  else
    Pct := 0;
  ProgressPercentLabel.Caption := IntToStr(Pct) + '%';

  TrackInner := UiX(468) - UiX(6);
  FillWidth := TrackInner * Pct div 100;
  if FillWidth < 1 then
    FillWidth := 1;
  if Pct >= 100 then begin
    { swap to the fully rounded pill at 100% }
    if not ProgressFillFullShown then begin
      ProgressFillImage.PngImage.LoadFromFile(
        ExpandConstant('{tmp}\progress-fill-full.png'));
      ProgressFillFullShown := True;
    end;
    FillWidth := UiX(468);
  end;
  ProgressFillImage.Visible := True;
  ProgressFillImage.Width := FillWidth;
end;

{ --- delta-update hash manifest logic (unchanged) -------------------------- }

function LoadHashManifest(const FileName: String; var Manifest: TArrayOfString): Boolean;
var
  Index, Separator, HashIndex: Integer;
  Line, HashValue, ManifestPath: String;
begin
  Result := False;
  if not FileExists(FileName) then
    Exit;
  try
    if not LoadStringsFromFile(FileName, Manifest) or (GetArrayLength(Manifest) = 0) then
      Exit;
    for Index := 0 to GetArrayLength(Manifest) - 1 do begin
      Line := Trim(Manifest[Index]);
      Separator := Pos('  ', Line);
      if Separator <= 0 then
        Exit;
      HashValue := Trim(Copy(Line, 1, Separator - 1));
      ManifestPath := Trim(Copy(Line, Separator + 2, Length(Line)));
      if (Length(HashValue) <> 64) or (ManifestPath = '') then
        Exit;
      for HashIndex := 1 to Length(HashValue) do
        if not (((HashValue[HashIndex] >= '0') and (HashValue[HashIndex] <= '9')) or
          ((HashValue[HashIndex] >= 'a') and (HashValue[HashIndex] <= 'f')) or
          ((HashValue[HashIndex] >= 'A') and (HashValue[HashIndex] <= 'F'))) then
          Exit;
    end;
    Result := True;
  except
    Result := False;
  end;
end;

function NormalizeManifestPath(Value: String): String;
begin
  StringChangeEx(Value, '/', '\', True);
  while (Length(Value) > 0) and (Value[1] = '\') do
    Delete(Value, 1, 1);
  Result := LowerCase(Value);
end;

function ManifestHashForPath(const Manifest: TArrayOfString; const RelativePath: String): String;
var
  Index, Separator: Integer;
  Line, ManifestPath: String;
begin
  Result := '';
  ManifestPath := NormalizeManifestPath(RelativePath);
  for Index := 0 to GetArrayLength(Manifest) - 1 do begin
    Line := Trim(Manifest[Index]);
    Separator := Pos('  ', Line);
    if Separator <= 0 then
      Continue;
    if NormalizeManifestPath(Copy(Line, Separator + 2, Length(Line))) = ManifestPath then begin
      Result := LowerCase(Trim(Copy(Line, 1, Separator - 1)));
      Exit;
    end;
  end;
end;

function ShouldInstallFile: Boolean;
var
  Destination, ApplicationDirectory, RelativePath, ExpectedHash, InstalledHash: String;
begin
  Result := True;
  if not HashManifestLoaded or not InstalledHashManifestLoaded then
    Exit;

  Destination := ExpandConstant(CurrentFileName);
  ApplicationDirectory := AddBackslash(ExpandConstant('{app}'));
  if not PathStartsWith(Destination, ApplicationDirectory, True) then
    Exit;

  RelativePath := Copy(Destination, Length(ApplicationDirectory) + 1, Length(Destination));
  ExpectedHash := ManifestHashForPath(HashManifest, RelativePath);
  InstalledHash := ManifestHashForPath(InstalledHashManifest, RelativePath);
  if (ExpectedHash = '') or (InstalledHash = '') or not FileExists(Destination) then
    Exit;

  Result := InstalledHash <> ExpectedHash;
  if not Result then begin
    Log('Skipping unchanged file: ' + RelativePath);
  end;
end;

function InitializeSetup: Boolean;
begin
  HashManifestLoaded := False;
  InstalledHashManifestLoaded := False;
  try
    ExtractTemporaryFile('SecAgent.files.sha256');
    HashManifestLoaded := LoadHashManifest(ExpandConstant('{tmp}\SecAgent.files.sha256'), HashManifest);
  except
    Log('Unable to load the installer file hash manifest; files will be checked by Inno Setup defaults.');
  end;
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  InstalledManifestFile, TemporaryManifestFile, NewInstalledManifestFile: String;
begin
  if CurStep = ssInstall then begin
    { snapshot the option checkboxes right before files are laid down }
    WantDesktop := DesktopCheck.Checked;
    WantStartMenu := StartMenuCheck.Checked;
    WantAutoStart := AutoStartCheck.Checked;

    InstalledManifestFile := ExpandConstant('{app}\SecAgent.files.sha256');
    InstalledHashManifestLoaded := LoadHashManifest(InstalledManifestFile, InstalledHashManifest);
    if InstalledHashManifestLoaded then
      Log('Loaded installed file hash manifest: ' + InstalledManifestFile)
    else
      Log('Installed file hash manifest is missing or invalid; all files will be installed.');
  end else if CurStep = ssPostInstall then begin
    if HashManifestLoaded then begin
      TemporaryManifestFile := ExpandConstant('{tmp}\SecAgent.files.sha256');
      InstalledManifestFile := ExpandConstant('{app}\SecAgent.files.sha256');
      NewInstalledManifestFile := ExpandConstant('{app}\SecAgent.files.sha256.new');
      DeleteFile(NewInstalledManifestFile);
      if CopyFile(TemporaryManifestFile, NewInstalledManifestFile, False) then begin
        DeleteFile(InstalledManifestFile);
        if RenameFile(NewInstalledManifestFile, InstalledManifestFile) then
          Log('Saved installed file hash manifest: ' + InstalledManifestFile)
        else
          Log('Unable to replace installed file hash manifest: ' + InstalledManifestFile);
      end else
        Log('Unable to stage installed file hash manifest: ' + InstalledManifestFile);
    end;
  end;
end;
