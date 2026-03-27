# Code Signing Setup Guide

This document explains how to configure code signing for `kb` release binaries so they don't trigger OS security warnings on macOS (Gatekeeper) or Windows (SmartScreen).

## Overview

The release workflow automatically signs binaries when the appropriate secrets are configured:

- **macOS**: Codesign with hardened runtime + Apple notarization
- **Windows**: Authenticode signing with timestamp
- **Linux**: No signing (no standard code signing requirement for Linux CLI tools)

Signing is **optional** — if secrets are not configured, the build succeeds and signing steps are skipped.

## Required GitHub Secrets

### macOS Signing

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE_BASE64` | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` certificate |
| `APPLE_IDENTITY` | Signing identity string (e.g., `Developer ID Application: Your Name (TEAMID)`) |
| `APPLE_ID` | Apple ID email address used for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID (10-character alphanumeric) |
| `APPLE_APP_PASSWORD` | App-specific password for notarization |

### Windows Signing

| Secret | Description |
|--------|-------------|
| `WINDOWS_CERTIFICATE_BASE64` | Base64-encoded `.pfx` Authenticode code signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the `.pfx` certificate |

## macOS Setup Instructions

### 1. Obtain a Developer ID Application Certificate

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/)
2. In Xcode or the Apple Developer portal, create a **Developer ID Application** certificate
3. Export the certificate from Keychain Access as a `.p12` file with a password

### 2. Encode the Certificate as Base64

```bash
base64 -i certificate.p12 | pbcopy
```

Paste the result as the `APPLE_CERTIFICATE_BASE64` secret.

### 3. Find Your Team ID

Your Team ID is visible at [developer.apple.com/account](https://developer.apple.com/account) under Membership Details. It's a 10-character alphanumeric string (e.g., `ABC1234DEF`).

### 4. Create an App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com/)
2. Sign in and navigate to **Sign-In and Security** → **App-Specific Passwords**
3. Generate a new password and label it (e.g., "kb notarization")
4. Use this as the `APPLE_APP_PASSWORD` secret

### 5. Determine Your Signing Identity

The signing identity looks like:
```
Developer ID Application: Your Name (TEAMID)
```

You can find it by running:
```bash
security find-identity -v -p codesigning
```

## Windows Setup Instructions

### 1. Obtain an Authenticode Code Signing Certificate

Purchase a code signing certificate from a trusted Certificate Authority:
- DigiCert
- Sectigo (Comodo)
- GlobalSign
- SSL.com

### 2. Export as `.pfx`

Export the certificate with its private key as a `.pfx` (PKCS#12) file. Set a strong password.

### 3. Encode the Certificate as Base64

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard
```

Or on Linux/macOS:
```bash
base64 -i certificate.pfx
```

Paste the result as the `WINDOWS_CERTIFICATE_BASE64` secret.

## How Signing Works in the Release Flow

1. A tag push (`v*`) triggers the release workflow
2. Each platform job builds the standalone binary
3. **macOS jobs**: `scripts/sign-macos.sh` runs codesign + notarization
4. **Windows jobs**: `scripts/sign-windows.ps1` runs Authenticode signing
5. Checksums are generated **after** signing (so they match the signed binaries)
6. Signed binaries and checksums are uploaded to the GitHub Release

The test-release workflow (`workflow_dispatch`) includes the same signing steps but guards them with secret-availability checks — signing is skipped if secrets are not configured.

## Troubleshooting

### macOS: "The signature of the binary is invalid"

- Ensure the certificate is a **Developer ID Application** certificate (not Developer ID Installer or Mac App Distribution)
- Check that the certificate hasn't expired
- Verify the base64 encoding is correct: `echo "$APPLE_CERTIFICATE_BASE64" | base64 --decode | file -`

### macOS: Notarization fails with "Invalid credentials"

- Verify `APPLE_ID` is your Apple ID email
- Verify `APPLE_APP_PASSWORD` is an app-specific password (not your Apple ID password)
- Verify `APPLE_TEAM_ID` matches the team that issued the certificate

### macOS: Notarization fails with "The software is not signed"

- Ensure the `--options runtime` flag is used during codesign (hardened runtime is required for notarization)
- The `sign-macos.sh` script handles this automatically

### Windows: "signtool not found"

- `signtool.exe` is included in the Windows SDK, which is pre-installed on GitHub Actions Windows runners
- For local testing, install the Windows SDK or Visual Studio Build Tools

### Windows: "The specified PFX password is not correct"

- Double-check the `WINDOWS_CERTIFICATE_PASSWORD` secret matches the password used when exporting the `.pfx`

### Signing step skipped

- In the test-release workflow, signing is intentionally skipped when secrets are not configured
- Verify the secrets are set at the repository level in **Settings → Secrets and variables → Actions**
