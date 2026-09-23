"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

// ========================================
// CONFIG
// ========================================

const ROOT = __dirname;

const CONFIG_FILE = path.join(
  ROOT,
  "config.ini"
);

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      `Config file tidak ditemukan: ${CONFIG_FILE}`
    );
  }

  const content = fs.readFileSync(
    CONFIG_FILE,
    "utf8"
  );

  const config = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const separatorIndex =
      line.indexOf("=");

    if (separatorIndex === -1) {
      throw new Error(
        `Format config tidak valid: ${rawLine}`
      );
    }

    const key =
      line
        .slice(0, separatorIndex)
        .trim();

    const value =
      line
        .slice(separatorIndex + 1)
        .trim();

    if (!key) {
      throw new Error(
        `Config key tidak valid: ${rawLine}`
      );
    }

    config[key] = value;
  }

  return config;
}

const config = loadConfig();

function getConfig(name) {
  const value = config[name];

  if (!value) {
    throw new Error(
      `Config ${name} belum didefinisikan di config.ini.`
    );
  }

  return value;
}

// --------------------------------
// PROXY CONFIG
// --------------------------------

const FRONTEND_HOST =
  getConfig("FRONTEND_HOST");

const FRONTEND_PORT =
  Number(
    getConfig("FRONTEND_PORT")
  );

const BACKEND_HOST =
  getConfig("BACKEND_HOST");

const BACKEND_PORT =
  Number(
    getConfig("BACKEND_PORT")
  );

const PROXY_HOST =
  getConfig("PROXY_HOST");

const PROXY_PORT =
  Number(
    getConfig("PROXY_PORT")
  );

// ========================================
// PROXY SERVER
// ========================================

const proxy = http.createServer(
  (req, res) => {
    const isApi =
      req.url === "/api" ||
      req.url.startsWith("/api/");

    const targetHost =
      isApi
        ? BACKEND_HOST
        : FRONTEND_HOST;

    const targetPort =
      isApi
        ? BACKEND_PORT
        : FRONTEND_PORT;

    const options = {
      hostname: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${targetHost}:${targetPort}`,
      },
    };

    const proxyReq = http.request(
      options,
      (proxyRes) => {
        res.writeHead(
          proxyRes.statusCode,
          proxyRes.headers
        );

        proxyRes.pipe(res);
      }
    );

    proxyReq.on(
      "error",
      (error) => {
        console.error(
          "Proxy error:",
          error.message
        );

        if (!res.headersSent) {
          res.writeHead(
            502,
            {
              "Content-Type":
                "application/json",
            }
          );
        }

        res.end(
          JSON.stringify({
            success: false,
            message:
              "Proxy target unavailable",
          })
        );
      }
    );

    req.pipe(proxyReq);
  }
);

// ========================================
// START PROXY
// ========================================

proxy.listen(
  PROXY_PORT,
  PROXY_HOST,
  () => {
    console.log(
      `Reverse proxy running on http://${PROXY_HOST}:${PROXY_PORT}`
    );
  }
);