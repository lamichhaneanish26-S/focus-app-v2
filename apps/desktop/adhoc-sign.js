// Macs with Apple chips refuse to open apps with no signature at all ("app is damaged").
// We don't have a paid Apple certificate, so we add a free "ad-hoc" signature instead.
// People still need to approve the app once (System Settings → Privacy & Security → Open Anyway).
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log("Ad-hoc signing", appPath);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
};
