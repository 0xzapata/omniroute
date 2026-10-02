import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Execute the actual Docker RUN instruction with offline installer fixtures.
// Devin's official installer ends by invoking `devin setup`, which requires login.
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const command = dockerfile
  .replace(/\\\n\s*/g, " ")
  .split("\n")
  .find((line) => line.startsWith("RUN curl -fsSL https://ampcode.com/install.sh"))
  ?.slice(4);
assert.ok(command, "runner-cli installer instruction must exist");

test("global CLI install explicitly permits required npm 12 lifecycle scripts", () => {
  const install = dockerfile.match(/npm install -g [^\n]*@openai\/codex@latest[^\n]*/)?.[0];
  assert.ok(install, "global CLI install must exist");
  const allowed = install.match(/--allow-scripts=([^\s]+)/)?.[1].split(",") ?? [];
  for (const name of [
    "@anthropic-ai/claude-code",
    "droid",
    "opencode-ai",
    "openclaw",
    "esbuild",
    "koffi",
    "protobufjs",
  ]) {
    assert.ok(allowed.includes(name), `${name} needs an explicit lifecycle-script approval`);
  }
  assert.ok(!allowed.includes("*"), "do not approve arbitrary dependency scripts");
});

for (const installerStatus of [0, 19]) {
  test(`CLI installation skips onboarding and preserves installer status ${installerStatus}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "omniroute-cli-install-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const executable = (name, source) => writeFileSync(join(bin, name), source, { mode: 0o755 });
      executable(
        "curl",
        `#!/bin/sh
case "$2" in
  https://ampcode.com/install.sh) printf '#!/bin/sh\\nexit 0\\n' > "$4" ;;
  https://cli.devin.ai/install.sh) cp "$TEST_INSTALLER" "$4" ;;
  *) exit 90 ;;
esac
`
      );
      for (const name of ["codex", "claude", "opencode", "amp"]) {
        executable(name, "#!/bin/sh\nexit 0\n");
      }
      executable(
        "devin",
        `#!/bin/sh
if [ "$1" = setup ]; then
  echo 'Error: Login canceled' >&2
  exit 42
fi
test "$1" = --version
`
      );
      const installer = join(dir, "installer.sh");
      writeFileSync(
        installer,
        `#!/bin/bash
set -eu
VERSION_DIR="$TEST_ROOT"
COMPILED_BIN_NAME=devin
test "$TEST_INSTALL_STATUS" = 0 || exit "$TEST_INSTALL_STATUS"
"$VERSION_DIR/bin/$COMPILED_BIN_NAME" setup
`
      );
      const result = spawnSync(
        "sh",
        [
          "-ec",
          command
            .replaceAll("/tmp/install-amp.sh", '"$TEST_ROOT/amp.sh"')
            .replaceAll("/tmp/install-devin.sh", '"$TEST_ROOT/devin.sh"'),
        ],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            TEST_ROOT: dir,
            TEST_INSTALLER: installer,
            TEST_INSTALL_STATUS: String(installerStatus),
          },
          encoding: "utf8",
          timeout: 10000,
        }
      );
      assert.equal(result.status, installerStatus, result.stderr);
      assert.doesNotMatch(result.stderr, /Login canceled/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
