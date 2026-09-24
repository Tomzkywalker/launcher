const {
  fetchRepository,
  pullRepository,
  getGitInfo,
} = require("./pull");

const {
  spawn,
  execFile,
  execFileSync,
} = require("child_process");

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ========================================
// CONFIG
// ========================================

const ROOT = __dirname;
const IS_WINDOWS = process.platform === "win32";

// ========================================
// SINGLE INSTANCE
// ========================================

const LOCK_FILE = path.join(
  ROOT,
  ".launcher.lock"
);

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireLauncherLock() {
  while (true) {
    try {
      fs.writeFileSync(
        LOCK_FILE,
        JSON.stringify({
          pid: process.pid,
        }),
        {
          encoding: "utf8",
          flag: "wx",
        }
      );

      return;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }

      let existingPid = null;

      try {
        const lockContent =
          fs.readFileSync(
            LOCK_FILE,
            "utf8"
          );

        existingPid =
          Number(
            JSON.parse(lockContent).pid
          );
      } catch {
        // Lock may be stale or invalid.
      }

      if (
        isProcessRunning(
          existingPid
        )
      ) {
        console.log(
          "Launcher is already running."
        );

        process.exit(0);
      }

      try {
        fs.unlinkSync(
          LOCK_FILE
        );
      } catch (unlinkError) {
        if (
          unlinkError.code !==
          "ENOENT"
        ) {
          continue;
        }
      }
    }
  }
}

function releaseLauncherLock() {
  try {
    const lockContent =
      fs.readFileSync(
        LOCK_FILE,
        "utf8"
      );

    const lockPid =
      Number(
        JSON.parse(lockContent).pid
      );

    if (
      lockPid === process.pid
    ) {
      fs.unlinkSync(
        LOCK_FILE
      );
    }
  } catch {
    // Lock may already be gone.
  }
}

acquireLauncherLock();

process.on(
  "exit",
  () => {
    releaseLauncherLock();
  }
);

// Maximum time a service is allowed to wait
// for its readyPattern before startup is failed.
const STARTUP_TIMEOUT = 30_000;

// Maximum time allowed for graceful shutdown.
const GRACEFUL_STOP_TIMEOUT = 10_000;

// Maximum time to wait after force kill.
const FORCE_STOP_TIMEOUT = 3_000;

// ========================================
// LAUNCHER CONFIG
// ========================================
//
// Semua lokasi service dikontrol dari config.ini.
//
// Format:
// KEY=VALUE
//
// Baris kosong dan komentar yang diawali #
// akan diabaikan.
//
// Path absolute maupun relative didukung.
//
// Relative path akan dihitung relatif terhadap
// lokasi launcher.js.
//
// PROXY_SCRIPT hanya nama file yang dijalankan
// dari PROXY_PATH.
//

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
      line.slice(0, separatorIndex).trim();

    const value =
      line.slice(separatorIndex + 1).trim();

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

function getConfiguredPath(variableName) {
  const configuredPath =
    config[variableName];

  if (!configuredPath) {
    throw new Error(
      `Config ${variableName} belum didefinisikan di config.ini.`
    );
  }

  return path.resolve(
    ROOT,
    configuredPath
  );
}

function getConfiguredFile(variableName) {
  const configuredFile =
    config[variableName];

  if (!configuredFile) {
    throw new Error(
      `Config ${variableName} belum didefinisikan di config.ini.`
    );
  }

  return configuredFile;
}

function getConfiguredPort(variableName) {
  const configuredPort =
    config[variableName];

  if (!configuredPort) {
    throw new Error(
      `Config ${variableName} belum didefinisikan di config.ini.`
    );
  }

  const port =
    Number(configuredPort);

  if (!Number.isInteger(port)) {
    throw new Error(
      `Config ${variableName} harus berupa angka.`
    );
  }

  return port;
}

// ========================================
// SERVICE PATHS
// ========================================

const BACKEND_PATH =
  getConfiguredPath(
    "BACKEND_PATH"
  );

const FRONTEND_PATH =
  getConfiguredPath(
    "FRONTEND_PATH"
  );

const PROXY_PATH =
  getConfiguredPath(
    "PROXY_PATH"
  );

const PROXY_SCRIPT =
  getConfiguredFile(
    "PROXY_SCRIPT"
  );

// ========================================
// SERVICE PORTS
// ========================================

const BACKEND_PORT =
  getConfiguredPort(
    "BACKEND_PORT"
  );

const FRONTEND_PORT =
  getConfiguredPort(
    "FRONTEND_PORT"
  );

const PROXY_PORT =
  getConfiguredPort(
    "PROXY_PORT"
  );

// ========================================
// SERVICE COMMAND
// ========================================

function getNpmCommand() {
  if (IS_WINDOWS) {
    return {
      command: process.env.ComSpec,
      args: [
        "/d",
        "/s",
        "/c",
        "npm.cmd run dev",
      ],
    };
  }

  return {
    command: "npm",
    args: ["run", "dev"],
  };
}

// ========================================
// SERVICES
// ========================================

const services = {
  backend: {
    name: "Backend",

    cwd: BACKEND_PATH,
    port: BACKEND_PORT,
    gitPath: BACKEND_PATH,

    ...getNpmCommand(),

    readyPattern:
      "KEPK API server running",

    process: null,
    status: "STOPPED",
    stopping: false,
  },

  frontend: {
    name: "Frontend",

    cwd: FRONTEND_PATH,
    port: FRONTEND_PORT,
    gitPath: FRONTEND_PATH,

    ...getNpmCommand(),

    readyPattern: "VITE",

    process: null,
    status: "STOPPED",
    stopping: false,
  },

  proxy: {
    name: "Proxy",

    cwd: PROXY_PATH,
    port: PROXY_PORT,
    gitPath: null,

    command: process.execPath,
    args: [PROXY_SCRIPT],

    readyPattern:
      "Reverse proxy running",

    process: null,
    status: "STOPPED",
    stopping: false,
  },
};

// ========================================
// INPUT STATE
// ========================================

let inputLocked = false;
let exiting = false;

// Prevent multiple shutdowns at once.
let shutdownPromise = null;

// ========================================
// CLEAR TERMINAL
// ========================================

function clearScreen() {
  if (IS_WINDOWS) {
    try {
      execFileSync(
        process.env.ComSpec,
        ["/c", "cls"],
        {
          stdio: "inherit",
        }
      );
    } catch {
      process.stdout.write(
        "\x1b[2J\x1b[H"
      );
    }

    return;
  }

  process.stdout.write(
    "\x1b[2J\x1b[H"
  );
}

// ========================================
// STATUS
// ========================================

function formatRelativeTime(timestamp) {
  const seconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - timestamp) / 1000
      )
    );

  if (seconds < 60) {
    return "just now";
  }

  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [name, size] of units) {
    if (seconds >= size) {
      const value =
        Math.floor(seconds / size);

      return `${value} ${name}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}

function getSyncStatus(gitInfo) {
  const parts = [];

  if (gitInfo.ahead > 0) {
    parts.push(
      `AHEAD ${gitInfo.ahead}`
    );
  }

  if (gitInfo.behind > 0) {
    parts.push(
      `BEHIND ${gitInfo.behind}`
    );
  }

  return parts.length
    ? parts.join(" | ")
    : "UP TO DATE";
}

function printStatus() {
  console.log("");
  console.log("=== GIT STATUS ===");

  for (const service of [
    services.backend,
    services.frontend,
  ]) {
	  console.log("");
    const gitInfo =
      getGitInfo(
        service.gitPath
      );

    if (!gitInfo) {
      console.log(
        `${service.name.padEnd(10)} Git information unavailable`
      );
	  console.log("");

      continue;
    }

    console.log(
      `${service.name.padEnd(10)} ${gitInfo.branch.padEnd(5)} | ${gitInfo.workingTree} | ${getSyncStatus(gitInfo)}`
    );
    
    const hasRemoteDifference =
      gitInfo.ahead > 0 ||
      gitInfo.behind > 0;
    
    console.log(
      `           ${hasRemoteDifference ? "├" : "└"}─ Local  : ${gitInfo.commit} ${gitInfo.message} | ${formatRelativeTime(gitInfo.timestamp)}`
    );
    
    if (
      hasRemoteDifference &&
      gitInfo.remoteCommit
    ) {
      console.log(
        `           └─ Remote : ${gitInfo.remoteCommit} ${gitInfo.remoteMessage} | ${formatRelativeTime(gitInfo.remoteTimestamp)}`
      );
    }
  }

  console.log("");
  console.log("=== SERVICES ===");
  console.log("");

  for (const service of Object.values(
    services
  )) {
    const icon =
      service.status === "RUNNING"
        ? "●"
        : service.status === "CRASHED"
          ? "✖"
          : "○";

    const portText =
      service.status === "RUNNING"
        ? ` on Port : ${service.port}`
        : "";

    console.log(
      `${service.name.padEnd(10)} ${icon} ${service.status}${portText}`
    );
  }

  console.log("");
}

// ========================================
// MENU
// ========================================

function showMenu() {
  printStatus();

  console.log("Commands:");
  console.log("");
  console.log("1. Start All");
  console.log("2. Start Backend");
  console.log("3. Start Frontend");
  console.log("4. Start Proxy");
  console.log("");
  console.log("5. Stop All");
  console.log("6. Stop Backend");
  console.log("7. Stop Frontend");
  console.log("8. Stop Proxy");
  console.log("");
  console.log("R. Git Refresh Status");
  console.log("F. Git Pull Frontend");
  console.log("B. Git Pull Backend");
  console.log("");
  console.log("9. Refresh");
  console.log("0. Exit");
}

// ========================================
// KILL WINDOWS PROCESS TREE
// ========================================

function killWindowsProcessTree(pid) {
  return new Promise(
    (resolve) => {
      if (!pid) {
        resolve(false);
        return;
      }

      execFile(
        "taskkill",
        [
          "/PID",
          String(pid),
          "/T",
          "/F",
        ],
        {
          windowsHide: true,
        },
        (error) => {
          if (error) {
            console.error(
              `[WARN] Could not terminate Windows process tree for PID ${pid}.`
            );

            resolve(false);
            return;
          }

          resolve(true);
        }
      );
    }
  );
}

// ========================================
// TERMINATE CHILD PROCESS
// ========================================

async function terminateChild(child) {
  if (!child) {
    return;
  }

  if (IS_WINDOWS) {
    await killWindowsProcessTree(
      child.pid
    );

    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // Process may already be gone.
  }
}

// ========================================
// START SERVICE
// ========================================

function startService(service) {
  return new Promise(
    (resolve, reject) => {
      // Already running
      if (service.process) {
        console.log(
          `[SKIP] ${service.name} already running.`
        );

        resolve({
          skipped: true,
          ready:
            service.status === "RUNNING",
        });

        return;
      }

      console.log(
        `[START] ${service.name}...`
      );

      service.stopping = false;
      service.status = "STARTING";

      const child = spawn(
        service.command,
        service.args,
        {
          cwd: service.cwd,

          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],

          windowsHide: false,
        }
      );

      service.process = child;

      let ready = false;
      let settled = false;
      let startupTimer = null;

      // Buffer untuk mendeteksi readyPattern
      // walaupun output process datang dalam
      // beberapa data chunk.
      let outputBuffer = "";

      // --------------------------------
      // CLEANUP STARTUP TIMER
      // --------------------------------

      function clearStartupTimer() {
        if (startupTimer) {
          clearTimeout(
            startupTimer
          );

          startupTimer = null;
        }
      }

      // --------------------------------
      // CLEANUP SERVICE STATE
      // --------------------------------

      function cleanupServiceState(
        finalStatus = "STOPPED"
      ) {
        if (
          service.process === child
        ) {
          service.process = null;
        }

        service.status = finalStatus;
        service.stopping = false;
      }

      // --------------------------------
      // RESOLVE READY
      // --------------------------------

      function resolveReady() {
        if (settled) {
          return;
        }

        settled = true;

        clearStartupTimer();

        service.status = "RUNNING";

        console.log(
          `[READY] ${service.name}`
        );

        resolve({
          skipped: false,
          ready: true,
        });
      }

      // --------------------------------
      // READY DETECTION
      // --------------------------------

      function checkReady(data) {
        outputBuffer += data.toString();

        if (
          !ready &&
          outputBuffer.includes(
            service.readyPattern
          )
        ) {
          ready = true;

          resolveReady();
        }

        // Prevent unlimited memory growth.
        if (outputBuffer.length > 10_000) {
          outputBuffer =
            outputBuffer.slice(-10_000);
        }
      }

      // --------------------------------
      // STDOUT
      // --------------------------------

      child.stdout.on(
        "data",
        (data) => {
          process.stdout.write(
            `[${service.name}] ${data}`
          );

          checkReady(data);
        }
      );

      // --------------------------------
      // STDERR
      // --------------------------------

      child.stderr.on(
        "data",
        (data) => {
          process.stderr.write(
            `[${service.name}] ${data}`
          );

          checkReady(data);
        }
      );

      // --------------------------------
      // ERROR
      // --------------------------------

      child.on(
        "error",
        (error) => {
          clearStartupTimer();

          cleanupServiceState(
            "STOPPED"
          );

          if (!settled) {
            settled = true;

            reject(error);
          }
        }
      );

      // --------------------------------
      // EXIT
      // --------------------------------

      child.on(
        "exit",
        (code, signal) => {
          const wasStopping =
            service.stopping;

          clearStartupTimer();

          // --------------------------------
          // Startup failed before READY
          // --------------------------------

          if (
            !ready &&
            !settled
          ) {
            cleanupServiceState(
              "STOPPED"
            );

            settled = true;

            reject(
              new Error(
                `${service.name} stopped before becoming ready.`
              )
            );

            return;
          }

          // --------------------------------
          // Intentional stop
          // --------------------------------

          if (wasStopping) {
            cleanupServiceState(
              "STOPPED"
            );

            return;
          }

          // --------------------------------
          // Unexpected stop
          // --------------------------------

          if (
            ready &&
            !exiting
          ) {
            cleanupServiceState(
              "CRASHED"
            );

            const reason =
              signal
                ? `Signal: ${signal}`
                : `Exit code: ${code}`;

            handleUnexpectedStop(
              service,
              reason
            );

            return;
          }

          cleanupServiceState(
            "STOPPED"
          );
        }
      );

      // --------------------------------
      // STARTUP TIMEOUT
      // --------------------------------

      startupTimer = setTimeout(
        async () => {
          if (
            settled ||
            ready
          ) {
            return;
          }

          service.stopping = true;

          clearStartupTimer();

          console.error("");

          console.error(
            `[TIMEOUT] ${service.name} did not become ready within ${STARTUP_TIMEOUT / 1000} seconds.`
          );

          console.error("");

          try {
            await terminateChild(
              child
            );
          } catch {
            // Ignore termination errors.
          }

          cleanupServiceState(
            "STOPPED"
          );

          if (!settled) {
            settled = true;

            reject(
              new Error(
                `${service.name} startup timeout after ${STARTUP_TIMEOUT / 1000} seconds.`
              )
            );
          }
        },
        STARTUP_TIMEOUT
      );
    }
  );
}

// ========================================
// UNEXPECTED STOP
// ========================================

function handleUnexpectedStop(
  service,
  reason
) {
  if (exiting) {
    return;
  }

  console.log("");

  console.log(
    `⚠ ${service.name} stopped unexpectedly!`
  );

  console.log(
    `  ${reason}`
  );

  console.log("");

  if (!inputLocked) {
    showMenu();
  }
}

// ========================================
// STOP SERVICE
// ========================================

function stopService(service) {
  return new Promise(
    async (resolve) => {
      const child =
        service.process;

      // Already stopped
      if (!child) {
        service.status =
          "STOPPED";

        console.log(
          `[SKIP] ${service.name} already stopped.`
        );

        resolve({
          skipped: true,
        });

        return;
      }

      console.log(
        `[STOP] ${service.name}...`
      );

      service.stopping = true;
      service.status = "STOPPING";

      let finished = false;
      let gracefulTimer = null;
      let forceTimer = null;

      function cleanupTimers() {
        if (gracefulTimer) {
          clearTimeout(
            gracefulTimer
          );

          gracefulTimer = null;
        }

        if (forceTimer) {
          clearTimeout(
            forceTimer
          );

          forceTimer = null;
        }
      }

      function finish() {
        if (finished) {
          return;
        }

        finished = true;

        cleanupTimers();

        if (
          service.process === child
        ) {
          service.process = null;
        }

        service.status =
          "STOPPED";

        service.stopping = false;

        console.log(
          `[STOPPED] ${service.name}`
        );

        resolve({
          skipped: false,
        });
      }

      // Process benar-benar dianggap selesai
      // ketika event "exit" diterima.
      child.once(
        "exit",
        finish
      );

      // ========================================
      // WINDOWS
      // ========================================

      if (IS_WINDOWS) {
        await killWindowsProcessTree(
          child.pid
        );

        // Tunggu event "exit".
        return;
      }

      // ========================================
      // LINUX / macOS
      // ========================================

      try {
        child.kill("SIGTERM");
      } catch {
        finish();
        return;
      }

      // ========================================
      // GRACEFUL STOP TIMEOUT
      // ========================================

      gracefulTimer = setTimeout(
        () => {
          if (finished) {
            return;
          }

          console.warn(
            `[WARN] ${service.name} did not stop gracefully after ${GRACEFUL_STOP_TIMEOUT / 1000} seconds.`
          );

          console.warn(
            `[FORCE] Killing ${service.name}...`
          );

          try {
            child.kill("SIGKILL");
          } catch {
            // Process may already be gone.
          }

          // ========================================
          // FORCE STOP TIMEOUT
          // ========================================

          forceTimer = setTimeout(
            () => {
              if (finished) {
                return;
              }

              console.error(
                `[ERROR] ${service.name} did not exit after SIGKILL.`
              );

              finished = true;

              cleanupTimers();

              if (
                service.process === child
              ) {
                service.process = null;
              }

              service.status =
                "STOPPED";

              service.stopping = false;

              resolve({
                skipped: false,
                forced: true,
                uncertain: true,
              });
            },
            FORCE_STOP_TIMEOUT
          );
        },
        GRACEFUL_STOP_TIMEOUT
      );
    }
  );
}

// ========================================
// START ALL
// ========================================

async function startAll() {
  clearScreen();

  console.log("=== START ALL ===");

  console.log("");

  try {
    // --------------------------------
    // BACKEND
    // --------------------------------

    const backendResult =
      await startService(
        services.backend
      );

    if (
      !backendResult.skipped
    ) {
      console.log("");
      console.log(
        "[WAIT] Backend ready. Continuing..."
      );
      console.log("");
    }

    // --------------------------------
    // FRONTEND
    // --------------------------------

    const frontendResult =
      await startService(
        services.frontend
      );

    if (
      !frontendResult.skipped
    ) {
      console.log("");
      console.log(
        "[WAIT] Frontend ready. Continuing..."
      );
      console.log("");
    }

    // --------------------------------
    // PROXY
    // --------------------------------

    await startService(
      services.proxy
    );

    console.log("");

    console.log(
      "=== ALL SERVICES READY ==="
    );

    console.log("");

    showMenu();
  } catch (error) {
    console.error("");

    console.error(
      `[FAILED] ${error.message}`
    );

    console.log("");

    showMenu();
  }
}

// ========================================
// STOP ALL
// ========================================

async function stopAll(
  showFinalMenu = true,
  shouldClear = true
) {
  if (shouldClear) {
    clearScreen();
  }

  console.log("=== STOP ALL ===");

  console.log("");

  // Proxy
  await stopService(
    services.proxy
  );

  // Frontend
  await stopService(
    services.frontend
  );

  // Backend
  await stopService(
    services.backend
  );

  console.log("");

  console.log(
    "=== ALL SERVICES STOPPED ==="
  );

  if (showFinalMenu) {
    console.log("");

    showMenu();
  }
}

// ========================================
// START SINGLE
// ========================================

async function startSingle(
  service
) {
  clearScreen();

  try {
    await startService(service);

    console.log("");

    showMenu();
  } catch (error) {
    console.error("");

    console.error(
      `[FAILED] ${error.message}`
    );

    console.log("");

    showMenu();
  }
}

// ========================================
// STOP SINGLE
// ========================================

async function stopSingle(
  service
) {
  clearScreen();

  await stopService(service);

  console.log("");

  showMenu();
}

// ========================================
// CLEAR UI
// ========================================

function refreshUI() {
  clearScreen();

  showMenu();
}

// ========================================
// CONFIRM GIT PULL
// ========================================

function confirmGitPull(name) {
  return new Promise(
    (resolve) => {
      console.log(
        `Pull latest ${name} from Git? (Y/N)`
      );

      const handler = (
        str,
        key
      ) => {
        if (
          key &&
          key.ctrl &&
          key.name === "c"
        ) {
          return;
        }

        if (!str) {
          return;
        }

        const answer =
          str.toLowerCase();

        if (
          answer !== "y" &&
          answer !== "n"
        ) {
          return;
        }

        process.stdin.off(
          "keypress",
          handler
        );

        resolve(
          answer === "y"
        );
      };

      process.stdin.on(
        "keypress",
        handler
      );
    }
  );
}

// ========================================
// GIT PULL FRONTEND
// ========================================

async function gitPullFrontend() {
  clearScreen();

  // --------------------------------
  // CONFIRM
  // --------------------------------

  const confirmed =
    await confirmGitPull(
      "Frontend"
    );

  if (!confirmed) {
    console.log("");
    console.log(
      "[CANCELLED] Frontend Git Pull."
    );

    console.log("");

    showMenu();

    return;
  }

  // --------------------------------
  // PULL FRONTEND
  // --------------------------------

  console.log("");

  await pullRepository(
    "Frontend",
    FRONTEND_PATH
  );

  console.log("");

  showMenu();
}

// ========================================
// GIT PULL BACKEND
// ========================================

async function gitPullBackend() {
  clearScreen();

  // --------------------------------
  // CONFIRM
  // --------------------------------

  const confirmed =
    await confirmGitPull(
      "Backend"
    );

  if (!confirmed) {
    console.log("");
    console.log(
      "[CANCELLED] Backend Git Pull."
    );

    console.log("");

    showMenu();

    return;
  }

  // --------------------------------
  // PULL BACKEND
  // --------------------------------

  console.log("");

  await pullRepository(
    "Backend",
    BACKEND_PATH
  );

  console.log("");

  showMenu();
}

// ========================================
// NORMAL GRACEFUL SHUTDOWN
// ========================================

async function gracefulShutdown() {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise =
    (async () => {
      exiting = true;
      inputLocked = true;

      clearScreen();

      console.log("=== EXIT ===");

      console.log("");

      await stopAll(
        false,
        false
      );

      console.log("");

      console.log(
        "Launcher closed."
      );

      console.log("");

      if (
        process.stdin.isTTY
      ) {
        try {
          process.stdin.setRawMode(
            false
          );
        } catch {
          // Ignore.
        }
      }

      releaseLauncherLock();

      process.exit(0);
    })();

  return shutdownPromise;
}

// ========================================
// EXIT
// ========================================

async function exitLauncher() {
  await gracefulShutdown();
}

// ========================================
// WINDOWS CONSOLE CLOSE
// ========================================
//
// Klik X pada console Windows menghasilkan
// SIGHUP pada Node.
//
// JANGAN menggunakan stopAll() di sini karena
// CTRL_CLOSE_EVENT Windows hanya memberi waktu
// terbatas untuk cleanup.
//
// Kita langsung terminate seluruh process tree
// milik setiap service.
//
// ========================================

async function emergencyWindowsShutdown() {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise =
    (async () => {
      exiting = true;
      inputLocked = true;

      // Tidak clear screen karena window sedang
      // dalam proses ditutup.

      for (const service of [
        services.proxy,
        services.frontend,
        services.backend,
      ]) {
        const child =
          service.process;

        if (!child) {
          continue;
        }

        service.stopping = true;

        try {
          await killWindowsProcessTree(
            child.pid
          );
        } catch {
          // Ignore.
        }

        // Jangan menunggu event "exit".
        //
        // Windows sedang melakukan close terhadap
        // console. Yang penting process tree
        // sudah dikirim ke taskkill /T /F.
        service.process = null;
        service.status = "STOPPED";
        service.stopping = false;
      }

      releaseLauncherLock();

      process.exit(0);
    })();

  return shutdownPromise;
}

// ========================================
// WINDOWS SIGHUP
// ========================================

if (IS_WINDOWS) {
  process.on(
    "SIGHUP",
    () => {
      emergencyWindowsShutdown();
    }
  );
}

// ========================================
// COMMAND HANDLER
// ========================================

async function handleCommand(
  command
) {
  // Ignore input while busy.
  if (inputLocked) {
    return;
  }

  // Only valid commands.
  if (
    ![
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "R",
      "F",
      "B",
    ].includes(command)
  ) {
    return;
  }

  inputLocked = true;

  try {
    switch (command) {
      // ------------------------------
      // START
      // ------------------------------

      case "1":
        await startAll();
        break;

      case "2":
        await startSingle(
          services.backend
        );
        break;

      case "3":
        await startSingle(
          services.frontend
        );
        break;

      case "4":
        await startSingle(
          services.proxy
        );
        break;

      // ------------------------------
      // STOP
      // ------------------------------

      case "5":
        await stopAll();
        break;

      case "6":
        await stopSingle(
          services.backend
        );
        break;

      case "7":
        await stopSingle(
          services.frontend
        );
        break;

      case "8":
        await stopSingle(
          services.proxy
        );
        break;

      // ------------------------------
      // CLEAR
      // ------------------------------

      case "9":
        refreshUI();
        break;

      // ------------------------------
      // EXIT
      // ------------------------------

      case "0":
        await exitLauncher();
        return;
		
      // ------------------------------
      // Pull
      // ------------------------------

      case "R":
        clearScreen();
      
        console.log("=== REFRESH GIT STATUS ===");
      
        console.log("");
      
        fetchRepository(
          "Backend",
          BACKEND_PATH
        );
      
        console.log("");
      
        fetchRepository(
          "Frontend",
          FRONTEND_PATH
        );
      
        showMenu();
        break;

      case "F":
        await gitPullFrontend();
        return;

      case "B":
        await gitPullBackend();
        return;

    }
  } finally {
    if (!exiting) {
      inputLocked = false;
    }
  }
}

// ========================================
// KEYBOARD
// ========================================

readline.emitKeypressEvents(
  process.stdin
);

if (
  process.stdin.isTTY
) {
  process.stdin.setRawMode(true);
}

// ========================================
// IGNORE CTRL+C
// ========================================

process.stdin.on(
  "keypress",
  async (str, key) => {
    // Ctrl+C sengaja diabaikan.
    if (
      key &&
      key.ctrl &&
      key.name === "c"
    ) {
      return;
    }

    // Ignore special keys.
    if (!str) {
      return;
    }

    // Valid menu keys.
    if (
      [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "R",
        "F",
        "B",
      ].includes(str)
    ) {
      await handleCommand(str);
    }
  }
);

// ========================================
// INITIAL UI
// ========================================

clearScreen();

console.log("=================================");
console.log("          DEV LAUNCHER           ");
console.log("=================================");

console.log("");

fetchRepository(
  "Backend",
  BACKEND_PATH
);

console.log("");

fetchRepository(
  "Frontend",
  FRONTEND_PATH
);

showMenu();