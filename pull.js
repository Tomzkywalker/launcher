"use strict";

const {
  spawn,
  execFileSync,
} = require("child_process");

// ========================================
// GIT FETCH REPOSITORY
// ========================================

function fetchRepository(
  name,
  cwd
) {
  console.log(
    `[FETCH] ${name}...`
  );

  try {
    runGit(
      cwd,
      [
        "fetch",
      ]
    );

    console.log(
      `[OK] ${name} refreshed.`
    );

    return {
      name,
      success: true,
    };
  } catch (error) {
    console.error(
      `[WARN] ${name} fetch failed.`
    );

    return {
      name,
      success: false,
      error,
    };
  }
}

// ========================================
// GIT PULL REPOSITORY
// ========================================

function pullRepository(
  name,
  cwd
) {
  return new Promise(
    (resolve) => {
      console.log(
        `[PULL] ${name}...`
      );

      const child = spawn(
        "git",
        ["pull"],
        {
          cwd,

          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],

          windowsHide: false,
        }
      );

      let settled = false;

      // --------------------------------
      // STDOUT
      // --------------------------------

      child.stdout.on(
        "data",
        (data) => {
          process.stdout.write(
            `[${name}] ${data}`
          );
        }
      );

      // --------------------------------
      // STDERR
      // --------------------------------

      child.stderr.on(
        "data",
        (data) => {
          process.stderr.write(
            `[${name}] ${data}`
          );
        }
      );

      // --------------------------------
      // SPAWN ERROR
      // --------------------------------

      child.on(
        "error",
        (error) => {
          if (settled) {
            return;
          }

          settled = true;

          console.error("");

          console.error(
            `[FAILED] ${name} pull failed.`
          );

          console.error(
            `[ERROR] ${error.message}`
          );

          resolve({
            name,
            success: false,
            error,
          });
        }
      );

      // --------------------------------
      // EXIT
      // --------------------------------

      child.on(
        "exit",
        (code, signal) => {
          if (settled) {
            return;
          }

          settled = true;

          if (code === 0) {
            console.log(
              `[OK] ${name} updated.`
            );

            resolve({
              name,
              success: true,
              code,
            });

            return;
          }

          console.error(
            `[FAILED] ${name} pull failed.`
          );

          if (signal) {
            console.error(
              `[ERROR] Git stopped by signal: ${signal}`
            );
          } else {
            console.error(
              `[ERROR] Git exited with code ${code}.`
            );
          }

          resolve({
            name,
            success: false,
            code,
            signal,
          });
        }
      );
    }
  );
}

// ========================================
// GIT COMMAND
// ========================================

function runGit(cwd, args) {
  return execFileSync(
    "git",
    args,
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    }
  ).trim();
}

// ========================================
// GET GIT INFO
// ========================================

function getGitInfo(cwd) {
  try {
    const branch =
      runGit(
        cwd,
        [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ]
      );

    const commit =
      runGit(
        cwd,
        [
          "rev-parse",
          "--short",
          "HEAD",
        ]
      );

    const message =
      runGit(
        cwd,
        [
          "log",
          "-1",
          "--format=%s",
        ]
      );

    const timestamp =
      Number(
        runGit(
          cwd,
          [
            "log",
            "-1",
            "--format=%ct",
          ]
        )
      ) * 1000;

    const workingTree =
      runGit(
        cwd,
        [
          "status",
          "--porcelain",
        ]
      )
        ? "MODIFIED"
        : "CLEAN";

    let ahead = 0;
    let behind = 0;

    try {
      const counts =
        runGit(
          cwd,
          [
            "rev-list",
            "--left-right",
            "--count",
            "HEAD...@{u}",
          ]
        ).split(/\s+/);

      ahead =
        Number(counts[0]) || 0;

      behind =
        Number(counts[1]) || 0;
    } catch {
      // Repository may not have an upstream.
    }

    return {
      branch,
      commit,
      message,
      timestamp,
      workingTree,
      ahead,
      behind,
    };
  } catch {
    return null;
  }
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  fetchRepository,
  pullRepository,
  getGitInfo,
};