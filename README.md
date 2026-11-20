# Chrome 浏览器扩展 (`chrome-extension/`)

本目录是 **GCP JSON 自动生成与归档工具 (v3.3.0)** 的 Chrome Manifest V3 扩展程序包，可直接通过 Chrome 的“加载已解压的扩展程序”安装使用。

## 文件说明

| 文件路径 | 作用说明 |
| :--- | :--- |
| `manifest.json` | Chrome 扩展配置清单（Manifest V3，含图标、弹出面板、权限声明） |
| `icons/` | 扩展程序高清图标（`icon16.png`、`icon48.png`、`icon128.png`） |
| `popup.html` / `popup.js` | 点击浏览器右上角扩展图标弹出的快捷导航面板 |
| `background.js` | Service Worker，校验并代理向官方 `https://script.google.com/macros/s/.../exec` 发起的归档请求 |
| `page-interceptor.js` | 运行于页面 `MAIN` 环境的拦截器，仅在激活的密钥生成阶段且精确匹配绑定项目与服务账号完整邮箱时捕获生成的 JSON |
| `content.js` | Google Cloud Console 页面右上角悬浮控制面板与跨页面全自动流水线引擎 |

## 安装步骤

1. 在 Chrome 浏览器地址栏输入 `chrome://extensions/` 并回车。
2. 打开页面右上角的 **开发者模式 (Developer mode)** 开关。
3. 点击左上角 **加载已解压的扩展程序 (Load unpacked)**。
4. 选择本 `chrome-extension` 文件夹即可完成安装。
5. 打开 [Google Cloud Console](https://console.cloud.google.com/)，页面右上角会自动出现控制面板。
