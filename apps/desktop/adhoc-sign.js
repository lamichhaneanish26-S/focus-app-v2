// Macs with Apple chips refuse to open apps with no signature at all ("app is damaged").
// We don't have a paid Apple certificate, so we add a free "ad-hoc" signature instead.
// People still need to approve the app once (System Settings → Privacy & Security → Open Anyway).
//
// The Mac download is one "universal" app built from an Intel half and an Apple-chip half.
// The halves are built in "...-temp" folders and must stay untouched until they are merged,
// so only the final, merged app gets signed.
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  if (/-temp$/.test(context.appOutDir)) return; // a half of the universal app: sign later
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log("Ad-hoc signing", appPath);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: "inherit" });
};
