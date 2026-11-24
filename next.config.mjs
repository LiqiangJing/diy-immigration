/**
 * 构建产物放在哪个目录。发布时新版本建到另一个目录里（.next-a / .next-b 轮流用），建好后再切换，
 * 这样构建的那一分钟里，正在运行的旧版本不会读到写了一半的文件。本地开发不设，用默认的 .next。
 */
const config = { distDir: process.env.DIY_DIST_DIR || ".next" };

export default config;
