# nsis/installer.nsh — custom hooks layered on electron-builder's assisted
# (non one-click) installer for AuthNo.
#
# What this adds over the stock installer:
#   • Pre-existing-version detection — when another build of AuthNo is already
#     installed, the installer now names that version and asks the user to
#     confirm the update before replacing it, instead of silently overwriting.
#   • The prompt states plainly that books + settings survive the update. That
#     guarantee is backed by nsis.deleteAppDataOnUninstall:false in
#     package.json: the previous version is uninstalled with its user data left
#     intact whenever a newer version installs over it.
#   • allowToChangeInstallationDirectory (package.json) keeps the
#     Choose-Location page available, so an install can still be pointed at a
#     different folder.
#
# electron-builder inserts these macros by name when they are defined. Every
# symbol referenced below — PRODUCT_NAME, VERSION, UNINSTALL_REGISTRY_KEY, and
# the $hasPerMachineInstallation / $hasPerUserInstallation flags — is provided
# by the generated installer. The $hasPer* flags are populated by
# initMultiUser, which runs immediately before customInit, and the registry
# view has already been set (check64BitAndSetRegView) by that point, so the
# reads below hit the correct 32/64-bit hive.
#
# NOTE on side-by-side versions: electron-builder keys a product on a single
# GUID, and both the shared install and uninstall registry keys (and the
# uninstaller's DeleteRegKey calls) are derived from it. Truly independent,
# co-existing versions would need a distinct per-release GUID, which directly
# conflicts with detecting and updating the previously-installed build. That is
# a build-pipeline change and is intentionally out of scope here; this file
# delivers reliable detect-and-update with non-destructive uninstall.

!macro customInit
  # $R7 holds the previously-installed version ("" when AuthNo isn't installed).
  # Registers are safe to clobber inside .onInit.
  StrCpy $R7 ""

  ${if} $hasPerMachineInstallation == "1"
    ReadRegStr $R7 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${endif}
  ${if} $R7 == ""
  ${andIf} $hasPerUserInstallation == "1"
    ReadRegStr $R7 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${endif}

  ${if} $R7 != ""
  ${andIf} $R7 != "${VERSION}"
    # A different build is present — confirm the in-place update. /SD IDOK keeps
    # silent runs (e.g. the app's own auto-updater) non-interactive.
    MessageBox MB_OKCANCEL|MB_ICONQUESTION \
"${PRODUCT_NAME} $R7 is already installed.$\r$\n$\r$\nSetup will update it to version ${VERSION}. Your books and settings are kept.$\r$\n$\r$\nClick OK to continue, or Cancel to keep $R7 and exit." \
      /SD IDOK IDOK authno_continue_install
    Quit
    authno_continue_install:
  ${endif}
!macroend
