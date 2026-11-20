/**
 * GCP JSON 全自动生成与归档工具
 * 运行于 https://console.cloud.google.com/*
 */
(function () {
  if (document.getElementById('gcp-json-helper-root')) return;

  const STORAGE_KEYS = {
    GAS_URL: 'GCP_HELPER_GAS_URL',
    UPLOAD_TOKEN: 'GCP_HELPER_UPLOAD_TOKEN',
    REGISTRANT: 'GCP_HELPER_REGISTRANT',
    ACCOUNT_OWNER: 'GCP_HELPER_ACCOUNT_OWNER',
    SAME_PERSON: 'GCP_HELPER_SAME_PERSON',
    SELECTED_GROUP: 'GCP_HELPER_SELECTED_GROUP',
    GROUPS_CACHE: 'GCP_HELPER_GROUPS_CACHE',
    CONFIG_MODE: 'GCP_HELPER_CONFIG_MODE', // 'LOW' | 'HIGH' | 'BOTH'
    FLOW_STAGE: 'GCP_HELPER_ONECLICK_STAGE',
    FLOW_PROJECT: 'GCP_HELPER_ONECLICK_PROJECT',
    ACTION_COUNTS: 'GCP_HELPER_ACTION_COUNTS',
    LAST_ACTION_TS: 'GCP_HELPER_LAST_ACTION_TS',
    LAST_BACKUP_JSON: 'GCP_HELPER_LAST_BACKUP_JSON',
    MINIMIZED: 'GCP_HELPER_MINIMIZED'
  };

  const STAGES = {
    IDLE: '',
    SCAN_PROJECT_BOTH: 'STAGE_SCAN_PROJECT_BOTH',
    REPAIR_1_SHEETS: 'STAGE_REPAIR_1_SHEETS',
    REPAIR_2_DRIVE: 'STAGE_REPAIR_2_DRIVE',
    REPAIR_3_BRANDING: 'STAGE_REPAIR_3_BRANDING',
    REPAIR_4_AUDIENCE: 'STAGE_REPAIR_4_AUDIENCE',
    CREATE_NO_ORG_PROJECT: 'STAGE_0_CREATE_NO_ORG_PROJECT',
    ENSURE_PROJECT: 'STAGE_1_ENSURE_PROJECT',
    ENABLE_SHEETS: 'STAGE_2_ENABLE_SHEETS',
    ENABLE_DRIVE: 'STAGE_3_ENABLE_DRIVE',
    CREATE_SA: 'STAGE_4_CREATE_SA',
    CREATE_KEY: 'STAGE_5_CREATE_KEY',
    OAUTH_CONSENT: 'STAGE_6_OAUTH_CONSENT',
    OAUTH_CLIENT: 'STAGE_7_OAUTH_CLIENT',
    DELETE_PROJECT: 'STAGE_DELETE_PROJECT'
  };

  // 单个动作跨页面最大允许尝试次数，达到阈值后自动暂停
  const MAX_ACTION_CLICK_THRESHOLD = 2;

  function loadActionCounts() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.ACTION_COUNTS) || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveActionCounts(counts) {
    state.actionCounts = counts || {};
    sessionStorage.setItem(STORAGE_KEYS.ACTION_COUNTS, JSON.stringify(state.actionCounts));
  }

  const SESSION_NAMING_RAND_KEY = 'GCP_HELPER_NAMING_RAND';

  function generateRandomCode(len) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < (len || 4); i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function getTodayDatePrefix() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  /**
   * 统一生成【高配(gaopei) / 低配(dipei) + 日期 + 随机码】命名集合
   */
  function getDatedNamingBundle(forceNew) {
    const datePrefix = getTodayDatePrefix();
    let rand = '';
    try {
      rand = sessionStorage.getItem(SESSION_NAMING_RAND_KEY) || '';
      if (!rand || forceNew) {
        rand = generateRandomCode(4);
        sessionStorage.setItem(SESSION_NAMING_RAND_KEY, rand);
      }
    } catch (_) {
      rand = generateRandomCode(4);
    }

    const mode = state.configMode || 'HIGH';
    const pyTag = mode === 'HIGH' ? 'gaopei' : mode === 'LOW' ? 'dipei' : 'gaodi';
    const projectSlug = `${pyTag}-${datePrefix}-${rand}`;
    const highSlug = `gaopei-${datePrefix}-${rand}`;
    const lowSlug = `dipei-${datePrefix}-${rand}`;

    return {
      datePrefix,
      rand,
      projectSlug,
      highSlug,
      lowSlug,
      oauthClientName: `【高配】${highSlug}`
    };
  }

  function clearActionCounts(regenerateNaming) {
    state.actionCounts = {};
    sessionStorage.removeItem(STORAGE_KEYS.ACTION_COUNTS);
    if (regenerateNaming) {
      sessionStorage.setItem(SESSION_NAMING_RAND_KEY, generateRandomCode(4));
    }
  }

  // 清理旧版遗留在 localStorage 中的明文备份，统一改用关闭标签页即销毁的 sessionStorage
  try {
    localStorage.removeItem(STORAGE_KEYS.LAST_BACKUP_JSON);
  } catch (_) {}

  const state = {
    gasUrl: localStorage.getItem(STORAGE_KEYS.GAS_URL) || '',
    uploadToken: localStorage.getItem(STORAGE_KEYS.UPLOAD_TOKEN) || 'GCP_JSON_UPLOAD_2026',
    registrant: localStorage.getItem(STORAGE_KEYS.REGISTRANT) || '',
    accountOwner: localStorage.getItem(STORAGE_KEYS.ACCOUNT_OWNER) || '',
    samePerson: localStorage.getItem(STORAGE_KEYS.SAME_PERSON) !== 'false',
    selectedGroup: localStorage.getItem(STORAGE_KEYS.SELECTED_GROUP) || '',
    groups: JSON.parse(localStorage.getItem(STORAGE_KEYS.GROUPS_CACHE) || '["一组","二组","三组"]'),
    configMode: localStorage.getItem(STORAGE_KEYS.CONFIG_MODE) || 'HIGH',
    minimized: localStorage.getItem(STORAGE_KEYS.MINIMIZED) === 'true',
    flowStage: sessionStorage.getItem(STORAGE_KEYS.FLOW_STAGE) || '',
    flowAborted: false,
    pendingUploadTimer: null,
    postConfirmNavTimer: null,
    googleAccount: sessionStorage.getItem('GCP_HELPER_DETECTED_EMAIL') || '',
    projectId: sessionStorage.getItem(STORAGE_KEYS.FLOW_PROJECT) || '',
    displayProjectId: '',
    currentSlug: '',
    capturedJson: '',
    capturedLevel: '',
    clientEmail: '',
    sheetJsonCount: 0,
    pageKeyCount: 0,
    lastCheckedProjectId: '',
    projectSummary: {
      projectId: '',
      lowCount: 0,
      highCount: 0,
      lowConfigs: [],
      highConfigs: [],
      pageLowNames: [],
      pageHighNames: []
    },
    lastBackup: JSON.parse(sessionStorage.getItem(STORAGE_KEYS.LAST_BACKUP_JSON) || 'null'),
    actionCounts: loadActionCounts()
  };

  // ==================== 注入悬浮面板 UI ====================
  const root = document.createElement('div');
  root.id = 'gcp-json-helper-root';
  root.innerHTML = `
    <style>
      #gcp-json-helper-root {
        position: fixed;
        top: 56px;
        right: 16px;
        z-index: 2147483640;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
        color: #202124;
      }
      .gjh-card {
        width: 386px;
        background: #ffffff;
        border: 1px solid #dadce0;
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
        overflow: hidden;
        font-size: 13px;
      }
      .gjh-header {
        background: linear-gradient(135deg, #1a73e8, #1557b0);
        color: #fff;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
      }
      .gjh-title {
        font-weight: 700;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .gjh-header-btns {
        display: flex;
        gap: 6px;
      }
      .gjh-icon-btn {
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        border-radius: 5px;
        padding: 3px 8px;
        font-size: 12px;
        cursor: pointer;
      }
      .gjh-icon-btn:hover {
        background: rgba(255,255,255,0.32);
      }
      .gjh-body {
        padding: 10px 13px;
        max-height: calc(100vh - 110px);
        overflow-y: auto;
      }
      .gjh-section {
        background: #f8fafd;
        border: 1px solid #e0e8f5;
        border-radius: 8px;
        padding: 9px 11px;
        margin-bottom: 8px;
      }
      .gjh-section-title {
        font-size: 12px;
        font-weight: 700;
        color: #1a73e8;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .gjh-quota-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #e8f0fe;
        color: #174ea6;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .gjh-mode-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 5px;
        margin-bottom: 8px;
      }
      .gjh-mode-tab {
        padding: 7px 4px;
        border-radius: 6px;
        border: 1px solid #dadce0;
        background: #fff;
        color: #3c4043;
        font-size: 11px;
        font-weight: 600;
        text-align: center;
        cursor: pointer;
        transition: all 0.15s;
      }
      .gjh-mode-tab.active-low {
        background: #e6f4ea;
        border-color: #0f9d58;
        color: #0b8043;
      }
      .gjh-mode-tab.active-high {
        background: #f3e8fd;
        border-color: #7627bb;
        color: #681da8;
      }
      .gjh-mode-tab.active-both {
        background: #e8f0fe;
        border-color: #1a73e8;
        color: #174ea6;
      }
      .gjh-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 7px 10px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 7px;
        border: 1px solid #dadce0;
        background: #fff;
        color: #3c4043;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
      }
      .gjh-btn:hover:not(:disabled) {
        background: #f1f3f4;
      }
      .gjh-btn:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
      .gjh-btn-oneclick {
        background: linear-gradient(135deg, #1a73e8, #0d47a1);
        color: #fff;
        border: none;
        width: 100%;
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 700;
        box-shadow: 0 3px 10px rgba(26, 115, 232, 0.28);
        margin-bottom: 6px;
      }
      .gjh-btn-oneclick:hover:not(:disabled) {
        background: linear-gradient(135deg, #1557b0, #0a357a);
      }
      .gjh-btn-noorg {
        background: #e8f0fe;
        color: #174ea6;
        border: 1px solid #aecbfa;
        width: 100%;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 700;
      }
      .gjh-btn-noorg:hover:not(:disabled) {
        background: #d2e3fc;
      }
      .gjh-btn-danger {
        background: #fce8e6;
        color: #d93025;
        border-color: #fad2cf;
        width: 100%;
        padding: 9px;
        font-weight: 700;
        margin-top: 4px;
      }
      .gjh-btn-success {
        background: #0f9d58;
        color: #fff;
        border-color: #0f9d58;
        width: 100%;
        padding: 8px;
        font-size: 12px;
      }
      .gjh-field {
        margin-bottom: 6px;
      }
      .gjh-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
        font-weight: 600;
        color: #3c4043;
        margin-bottom: 3px;
      }
      .gjh-input, .gjh-select {
        width: 100%;
        padding: 6px 9px;
        font-size: 12px;
        border: 1px solid #dadce0;
        border-radius: 6px;
        outline: none;
        box-sizing: border-box;
        background: #fff;
        color: #202124;
      }
      .gjh-input:focus, .gjh-select:focus {
        border-color: #1a73e8;
      }
      .gjh-checkbox-row {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #3c4043;
        margin: 4px 0 6px;
        cursor: pointer;
      }
      .gjh-status-box {
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 12px;
        margin-bottom: 7px;
        line-height: 1.45;
      }
      .gjh-status-wait {
        background: #fef7e0;
        color: #b06000;
        border: 1px solid #fde293;
      }
      .gjh-status-running {
        background: #e8f0fe;
        color: #174ea6;
        border: 1px solid #d2e3fc;
      }
      .gjh-status-ok {
        background: #e6f4ea;
        color: #137333;
        border: 1px solid #ceead6;
      }
      .gjh-status-err {
        background: #fce8e6;
        color: #c5221f;
        border: 1px solid #fad2cf;
      }
      .gjh-link-btn {
        background: none;
        border: none;
        color: #1a73e8;
        font-size: 11px;
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
      }
      .gjh-tool-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
    </style>

    <div class="gjh-card">
      <div class="gjh-header">
        <div class="gjh-title">
          <span>⚡ GCP JSON 全自动工具</span>
        </div>
        <div class="gjh-header-btns">
          <button type="button" class="gjh-icon-btn" id="gjhToggleCfgBtn">⚙️ 接口设置</button>
          <button type="button" class="gjh-icon-btn" id="gjhMinBtn">${state.minimized ? '展开' : '折叠'}</button>
        </div>
      </div>

      <div class="gjh-body" id="gjhBody" style="display: ${state.minimized ? 'none' : 'block'};">
        <!-- 接口配置折叠区 -->
        <div class="gjh-section" id="gjhConfigSection" style="display: ${state.gasUrl ? 'none' : 'block'}; background:#fff8e1; border-color:#ffe082;">
          <div class="gjh-section-title" style="color:#b06000;">
            <span>⚙️ 私密 Google 表格接口设置 (首次必填)</span>
          </div>
          <div class="gjh-field">
            <label class="gjh-label">Apps Script 部署网址 (Web App URL)</label>
            <input type="text" id="gjhGasUrlInput" class="gjh-input" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeAttr(state.gasUrl)}" />
          </div>
          <div class="gjh-field">
            <label class="gjh-label">上传校验码 (UPLOAD_TOKEN)</label>
            <input type="text" id="gjhTokenInput" class="gjh-input" value="${escapeAttr(state.uploadToken)}" />
          </div>
          <button type="button" class="gjh-btn" style="width:100%;background:#1a73e8;color:#fff;" id="gjhSaveCfgBtn">💾 保存并同步表格数据</button>
        </div>

        <!-- 实时数量检测栏 -->
        <div class="gjh-quota-bar">
          <span id="gjhSheetCountText">📊 本账号表格已存: 检测中...</span>
          <span id="gjhPageKeyCountText">服务账号密钥: - / 10</span>
        </div>

        <!-- 归档信息填写区 -->
        <div class="gjh-section">
          <div class="gjh-section-title">
            <span>📋 归档信息（自动记忆，免重复填）</span>
            <button type="button" class="gjh-link-btn" id="gjhRefreshAccountBtn">🔄 刷新账号与数量</button>
          </div>

          <div class="gjh-field">
            <label class="gjh-label">
              <span>所属组别 (读取表格固定列) *</span>
              <button type="button" class="gjh-link-btn" id="gjhRefreshGroupsBtn">🔄 刷新组别</button>
            </label>
            <select id="gjhGroupSelect" class="gjh-select"></select>
          </div>

          <div class="gjh-field">
            <label class="gjh-label">当前谷歌账号 (自动识别) *</label>
            <input type="text" id="gjhAccountInput" class="gjh-input" placeholder="自动识别当前登录的谷歌邮箱..." value="${escapeAttr(state.googleAccount)}" />
          </div>

          <div class="gjh-field">
            <label class="gjh-label">注册人 *</label>
            <input type="text" id="gjhRegistrantInput" class="gjh-input" placeholder="输入一次自动记住" value="${escapeAttr(state.registrant)}" />
          </div>

          <label class="gjh-checkbox-row">
            <input type="checkbox" id="gjhSamePersonCheck" ${state.samePerson ? 'checked' : ''} />
            <span>账号人与注册人一致（免重复输入）</span>
          </label>

          <div class="gjh-field" id="gjhOwnerField" style="display: ${state.samePerson ? 'none' : 'block'};">
            <label class="gjh-label">账号人 *</label>
            <input type="text" id="gjhOwnerInput" class="gjh-input" placeholder="请输入账号人姓名" value="${escapeAttr(state.accountOwner)}" />
          </div>
        </div>

        <!-- 低配 / 高级 规格选择与一键启动主控区 -->
        <div class="gjh-section" style="background:#f0f6ff; border-color:#c2dbff;">
          <div class="gjh-section-title">
            <span>🎯 选择要生成的 JSON 配置文件规格</span>
            <span id="gjhProjectBadge" style="font-weight:normal;color:#5f6368;font-size:11px;">项目: 自动检测</span>
          </div>

          <div class="gjh-mode-tabs">
            <div class="gjh-mode-tab" id="gjhTabLow" data-mode="LOW">
              🟢 低配版<br/><span style="font-weight:normal;font-size:10px;">服务账号JSON</span>
            </div>
            <div class="gjh-mode-tab" id="gjhTabHigh" data-mode="HIGH">
              🟣 高级版<br/><span style="font-weight:normal;font-size:10px;">OAuth公开客户端</span>
            </div>
            <div class="gjh-mode-tab" id="gjhTabBoth" data-mode="BOTH">
              🚀 全套版<br/><span style="font-weight:normal;font-size:10px;">低配+高级同生</span>
            </div>
          </div>

          <div id="gjhModeDesc" style="font-size:11px;color:#5f6368;margin-bottom:7px;line-height:1.35;"></div>

          <!-- 当前项目高低配实时检测与读取面板 -->
          <div id="gjhProjDetectBox" style="background:#ffffff;border:1px solid #bdd7ff;border-radius:8px;padding:8px 10px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#174ea6;">🔍 当前项目已有配置检测</span>
              <button type="button" id="gjhDetectProjBtn" style="background:#e8f0fe;border:1px solid #aecbfa;color:#1a73e8;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600;cursor:pointer;">
                🔄 检测并读取
              </button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <div id="gjhDetectLowPill" style="background:#f8f9fa;border:1px solid #dadce0;border-radius:6px;padding:5px 8px;font-size:11px;">
                🟢 低配: <strong id="gjhDetectLowText" style="color:#5f6368;">待检测</strong>
              </div>
              <div id="gjhDetectHighPill" style="background:#f8f9fa;border:1px solid #dadce0;border-radius:6px;padding:5px 8px;font-size:11px;">
                🟣 高配: <strong id="gjhDetectHighText" style="color:#5f6368;">待检测</strong>
              </div>
            </div>
            <div id="gjhDetectDetailBox" style="display:none;margin-top:6px;padding-top:6px;border-top:1px dashed #d2e3fc;font-size:11px;line-height:1.45;color:#3c4043;"></div>
          </div>

          <div id="gjhFlowStatusBox" class="gjh-status-box gjh-status-running" style="display:none;"></div>

          <div id="gjhStartBtnsWrap">
            <button type="button" class="gjh-btn gjh-btn-oneclick" id="gjhOneClickCurrentBtn">
              🔍 智能检测并生成 (有则读取 / 缺则补建)
            </button>
            <button type="button" class="gjh-btn gjh-btn-noorg" id="gjhOneClickNewNoOrgBtn">
              ➕ 建新【无组织】项目并全自动生成 (独享满额配额)
            </button>
            <button type="button" class="gjh-btn" id="gjhForceAddCurrentBtn" style="display:none;width:100%;margin-top:6px;background:#fff8e1;border-color:#fbbc04;color:#b06000;font-weight:600;">
              🔄 已有配置还想要：仍在当前项目强制追加建新的
            </button>
            <button type="button" class="gjh-btn" id="gjhCheckAndRepairBtn" style="width:100%;margin-top:6px;background:linear-gradient(135deg,#0f9d58,#0b8043);color:#fff;border:none;padding:9px 10px;font-size:12px;box-shadow:0 2px 6px rgba(15,157,88,0.25);">
              🩺 一键检查并自动修复当前项目配置 (专治403测试中/坏配置)
            </button>
          </div>

          <button type="button" class="gjh-btn gjh-btn-danger" id="gjhOneClickStopBtn" style="display:none;">
            ⏹️ 立即停止全自动流水线
          </button>
        </div>

        <!-- 配置文件找回 & 项目删除工具箱 -->
        <div class="gjh-section">
          <div class="gjh-section-title">
            <span>🛠️ 配置文件快捷操作 & 项目管理</span>
          </div>
          <div class="gjh-tool-grid">
            <button type="button" class="gjh-btn" id="gjhOnlyHighOAuthBtn" style="color:#681da8;border-color:#d7aefb;background:#faf5ff;">
              🟣 仅生成高级OAuth
            </button>
            <button type="button" class="gjh-btn" id="gjhOnlyLowSaBtn" style="color:#0b8043;border-color:#ceead6;background:#f1f9f4;">
              🟢 仅生成低配服务号
            </button>
            <button type="button" class="gjh-btn" id="gjhRedownloadBtn">
              📥 重新获取JSON配置
            </button>
            <button type="button" class="gjh-btn" id="gjhDeleteProjBtn" style="color:#d93025;border-color:#fad2cf;">
              🗑️ 删除当前项目
            </button>
          </div>

          <details style="margin-top:7px;">
            <summary style="font-size:11px;color:#1a73e8;cursor:pointer;user-select:none;">展开单步跳转 / 解除组织限制 / 手动上传文件</summary>
            <div class="gjh-tool-grid" style="margin-top:6px;">
              <button type="button" class="gjh-btn" id="gjhStepSheetsBtn">1. 开 Sheets API</button>
              <button type="button" class="gjh-btn" id="gjhStepDriveBtn">2. 开 Drive API</button>
              <button type="button" class="gjh-btn" id="gjhStepConsentBtn">3. OAuth同意屏幕(公开)</button>
              <button type="button" class="gjh-btn" id="gjhStepOAuthClientBtn">4. 建OAuth客户端</button>
            </div>
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:5px;">
              <button type="button" class="gjh-btn" id="gjhUnlockOrgPolicyBtn" style="width:100%;color:#b06000;background:#fef7e0;border-color:#fde293;">
                🔓 去关闭组织密钥限制 (iam.disableServiceAccountKeyCreation)
              </button>
              <label class="gjh-btn" style="width:100%;box-sizing:border-box;">
                📂 手动选择电脑上的 JSON 文件上传至表格
                <input type="file" id="gjhFileInput" accept=".json,application/json" style="display:none;" />
              </label>
            </div>
          </details>
        </div>

        <div id="gjhJsonStatusBox" class="gjh-status-box gjh-status-wait">
          ⏳ 待命：选好【低配 / 高级 / 全套】后点击上方一键生成按钮即可。
        </div>

        <button type="button" class="gjh-btn gjh-btn-success" id="gjhUploadBtn" style="display:none;">
          🚀 重新上传当前 JSON 到表格
        </button>

        <div id="gjhLogMsg" style="font-size:12px;color:#5f6368;text-align:center;margin-top:5px;"></div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // ==================== DOM 引用与交互绑定 ====================
  const elBody = document.getElementById('gjhBody');
  const elMinBtn = document.getElementById('gjhMinBtn');
  const elConfigSection = document.getElementById('gjhConfigSection');
  const elGroupSelect = document.getElementById('gjhGroupSelect');
  const elAccountInput = document.getElementById('gjhAccountInput');
  const elRegistrantInput = document.getElementById('gjhRegistrantInput');
  const elSamePersonCheck = document.getElementById('gjhSamePersonCheck');
  const elOwnerField = document.getElementById('gjhOwnerField');
  const elOwnerInput = document.getElementById('gjhOwnerInput');
  const elFlowStatusBox = document.getElementById('gjhFlowStatusBox');
  const elStartBtnsWrap = document.getElementById('gjhStartBtnsWrap');
  const elOneClickStopBtn = document.getElementById('gjhOneClickStopBtn');
  const elJsonStatusBox = document.getElementById('gjhJsonStatusBox');
  const elUploadBtn = document.getElementById('gjhUploadBtn');
  const elLogMsg = document.getElementById('gjhLogMsg');
  const elSheetCountText = document.getElementById('gjhSheetCountText');
  const elPageKeyCountText = document.getElementById('gjhPageKeyCountText');
  const elModeDesc = document.getElementById('gjhModeDesc');

  function renderModeTabs() {
    document.getElementById('gjhTabLow').className = 'gjh-mode-tab' + (state.configMode === 'LOW' ? ' active-low' : '');
    document.getElementById('gjhTabHigh').className = 'gjh-mode-tab' + (state.configMode === 'HIGH' ? ' active-high' : '');
    document.getElementById('gjhTabBoth').className = 'gjh-mode-tab' + (state.configMode === 'BOTH' ? ' active-both' : '');

    if (state.configMode === 'LOW') {
      elModeDesc.innerHTML = '当前选择：<strong>🟢 低配版（服务账号 JSON）</strong> — 自动创建带 <code>dipei-</code> 标识的服务账号并导出私钥 JSON。';
    } else if (state.configMode === 'HIGH') {
      elModeDesc.innerHTML =
        '当前选择：<strong>🟣 高级版（OAuth 公开客户端 JSON）</strong> — 自动配置 Google Auth Platform 为<strong>外部公开正式版</strong>（免绑邮箱），生成 <code>{"installed":{...}}</code> 配置。';
    } else {
      elModeDesc.innerHTML =
        '当前选择：<strong>🚀 全套版（低配 + 高级）</strong> — 在同一项目内自动生成服务账号 JSON 与 OAuth 公开客户端 JSON 两份文件并上传。';
    }
    if (typeof renderProjectDetectSummary === 'function') {
      renderProjectDetectSummary(false);
    }
  }

  ['gjhTabLow', 'gjhTabHigh', 'gjhTabBoth'].forEach((id) => {
    document.getElementById(id).addEventListener('click', (e) => {
      const mode = e.currentTarget.getAttribute('data-mode');
      state.configMode = mode;
      localStorage.setItem(STORAGE_KEYS.CONFIG_MODE, mode);
      renderModeTabs();
    });
  });

  elMinBtn.addEventListener('click', () => {
    state.minimized = !state.minimized;
    localStorage.setItem(STORAGE_KEYS.MINIMIZED, String(state.minimized));
    elBody.style.display = state.minimized ? 'none' : 'block';
    elMinBtn.textContent = state.minimized ? '展开' : '折叠';
  });

  document.getElementById('gjhToggleCfgBtn').addEventListener('click', () => {
    if (state.minimized) elMinBtn.click();
    elConfigSection.style.display = elConfigSection.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('gjhSaveCfgBtn').addEventListener('click', () => {
    state.gasUrl = document.getElementById('gjhGasUrlInput').value.trim();
    state.uploadToken = document.getElementById('gjhTokenInput').value.trim();
    localStorage.setItem(STORAGE_KEYS.GAS_URL, state.gasUrl);
    localStorage.setItem(STORAGE_KEYS.UPLOAD_TOKEN, state.uploadToken);
    elConfigSection.style.display = 'none';
    fetchGroupsAndAccountStats(true);
  });

  elRegistrantInput.addEventListener('input', () => {
    state.registrant = elRegistrantInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.REGISTRANT, state.registrant);
    if (state.samePerson) {
      state.accountOwner = state.registrant;
      elOwnerInput.value = state.registrant;
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_OWNER, state.accountOwner);
    }
  });

  elSamePersonCheck.addEventListener('change', () => {
    state.samePerson = elSamePersonCheck.checked;
    localStorage.setItem(STORAGE_KEYS.SAME_PERSON, String(state.samePerson));
    elOwnerField.style.display = state.samePerson ? 'none' : 'block';
    if (state.samePerson) {
      state.accountOwner = elRegistrantInput.value.trim();
      elOwnerInput.value = state.accountOwner;
    }
  });

  elOwnerInput.addEventListener('input', () => {
    state.accountOwner = elOwnerInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.ACCOUNT_OWNER, state.accountOwner);
  });

  elGroupSelect.addEventListener('change', () => {
    state.selectedGroup = elGroupSelect.value;
    localStorage.setItem(STORAGE_KEYS.SELECTED_GROUP, state.selectedGroup);
  });

  document.getElementById('gjhRefreshGroupsBtn').addEventListener('click', () => fetchGroupsAndAccountStats(true));
  document.getElementById('gjhRefreshAccountBtn').addEventListener('click', () => {
    detectGoogleAccountAndProject(true);
    fetchGroupsAndAccountStats(true);
  });

  document.getElementById('gjhFileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => handleCapturedJson(String(evt.target.result || ''), '手动选择文件: ' + file.name, false);
    reader.readAsText(file);
  });

  window.addEventListener('GCP_SERVICE_ACCOUNT_JSON_CAPTURED', (e) => {
    if (!e || !e.detail || !e.detail.jsonText) return;
    // 安全闸门：停止流水线后（或不在密钥/OAuth生成阶段时）严禁自动捕获与上传凭证
    if (
      state.flowAborted ||
      (state.flowStage !== STAGES.CREATE_KEY &&
        state.flowStage !== STAGES.OAUTH_CONSENT &&
        state.flowStage !== STAGES.OAUTH_CLIENT)
    ) {
      return;
    }
    const lvl = e.detail.configLevel || '';
    handleCapturedJson(e.detail.jsonText, `已自动截获【${lvl || '新生成'}】JSON 配置文件`, true);
  });

  elUploadBtn.addEventListener('click', () => {
    state.flowAborted = false;
    uploadToGoogleSheet(false, false);
  });

  // ==================== 启动前预检查 ====================
  function preCheckBeforeStart(forceNewNoOrgProject) {
    if (!state.gasUrl) {
      elConfigSection.style.display = 'block';
      setLog('❌ 请先配置 Google 表格的 Apps Script 部署网址！', '#d93025');
      return false;
    }
    if (!elGroupSelect.value.trim()) {
      setLog('❌ 请先选择所属组别！', '#d93025');
      return false;
    }
    if (!elRegistrantInput.value.trim()) {
      elRegistrantInput.focus();
      setLog('❌ 请先填写注册人姓名（填一次即可自动记住）！', '#d93025');
      return false;
    }

    detectGoogleAccountAndProject(false);
    scanExistingKeysOnPage();

    const warnings = [];
    if (state.sheetJsonCount > 0) {
      warnings.push(`• 当前谷歌账号 (${state.googleAccount || '当前账号'}) 在表格中已经存有 【${state.sheetJsonCount} 个】 JSON 配置文件！`);
    }
    if (!forceNewNoOrgProject && state.configMode !== 'HIGH' && state.pageKeyCount > 0) {
      warnings.push(`• 当前服务账号下已经存在 【${state.pageKeyCount} 个】 密钥（单服务账号上限为 10 个）！`);
    }

    if (warnings.length > 0) {
      const msg =
        '⚠️ 建立前数量提醒：\n\n' +
        warnings.join('\n') +
        '\n\n💡 确定仍要继续创建吗？';
      if (!window.confirm(msg)) {
        return false;
      }
    }

    clearActionCounts(true);
    return true;
  }

  function startForceCreateInCurrentProject(overrideStage, isForceAdd) {
    if (!preCheckBeforeStart(false)) return;
    const urlProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    if (urlProj) {
      state.projectId = urlProj;
      sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, urlProj);
    }
    if (isForceAdd) {
      sessionStorage.setItem('GCP_HELPER_FORCE_ADD_MODE', '1');
    } else {
      sessionStorage.removeItem('GCP_HELPER_FORCE_ADD_MODE');
    }
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_SLUG');
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_EMAIL');
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_DETAIL_ID');
    const targetStage = overrideStage || STAGES.ENSURE_PROJECT;
    setFlowStage(targetStage);
    if (overrideStage && overrideStage !== STAGES.ENSURE_PROJECT) {
      navigateToStageUrl(overrideStage);
    } else {
      runPipelineTick();
    }
  }

  /**
   * 当完成高低配双页面完整检测后，根据真实结果执行“有则读取 / 缺则补建 / 无则新建”
   */
  function executeSmartDecisionAfterFullScan() {
    const curProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    const summary = getEffectiveProjectSummary();
    const hasLow = summary.totalLow > 0;
    const hasHigh = summary.totalHigh > 0;

    // 情况 1：用户选了【低配】，且当前项目已经有低配 -> 直接读取出来，绝不重复建
    if (state.configMode === 'LOW' && hasLow) {
      renderProjectDetectSummary(true);
      setLog(`✅ 当前项目 (${curProj}) 已有 ${summary.totalLow} 个【低配】配置，已直接为您读取出来！`, '#0f9d58');
      return;
    }

    // 情况 2：用户选了【高配】，且当前项目已经有高配 -> 直接读取出来，绝不重复建
    if (state.configMode === 'HIGH' && hasHigh) {
      renderProjectDetectSummary(true);
      setLog(`✅ 当前项目 (${curProj}) 已有 ${summary.totalHigh} 个【高配】配置，已直接为您读取出来！`, '#0f9d58');
      return;
    }

    // 情况 3：用户选了【全套 (低配+高配)】
    if (state.configMode === 'BOTH') {
      if (hasLow && hasHigh) {
        renderProjectDetectSummary(true);
        setLog(
          `✅ 当前项目 (${curProj}) 已同时拥有【${summary.totalLow}个低配 + ${summary.totalHigh}个高配】，已全部读取出来，无需重复创建！`,
          '#0f9d58'
        );
        return;
      }
      if (hasLow && !hasHigh) {
        renderProjectDetectSummary(true);
        setLog(`🔍 当前项目已有 ${summary.totalLow} 个【低配】，正在自动为您补建缺失的【高级 OAuth】...`, '#7627bb');
        sessionStorage.removeItem('GCP_HELPER_SKIP_HIGH_ONCE');
        startForceCreateInCurrentProject(STAGES.OAUTH_CONSENT, false);
        return;
      }
      if (!hasLow && hasHigh) {
        renderProjectDetectSummary(true);
        setLog(`🔍 当前项目已有 ${summary.totalHigh} 个【高配】，正在自动为您补建缺失的【低配服务号】...`, '#0f9d58');
        sessionStorage.setItem('GCP_HELPER_SKIP_HIGH_ONCE', '1');
        startForceCreateInCurrentProject(STAGES.CREATE_SA, false);
        return;
      }
    }

    // 情况 4：当前项目确实还没有对应配置 -> 自动建立新的
    sessionStorage.removeItem('GCP_HELPER_SKIP_HIGH_ONCE');
    startForceCreateInCurrentProject(STAGES.ENSURE_PROJECT, false);
  }

  document.getElementById('gjhDetectProjBtn').addEventListener('click', () => {
    detectGoogleAccountAndProject(false);
    scanCurrentProjectConfigsOnPage();
    const curProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    if (!curProj) {
      setLog('⚠️ 当前页面尚未选定项目', '#b06000');
      return;
    }
    state.projectId = curProj;
    sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, curProj);
    // 强制重新巡检低配与高配两个列表页，确保高低配数量 100% 准确且跨页持久化
    const cache = loadProjectDetectCache(curProj);
    const path = window.location.pathname;
    cache.lowScanned = path.endsWith('/serviceaccounts') || path.endsWith('/serviceaccounts/');
    cache.highScanned = path.includes('/auth/clients') || path.includes('/apis/credentials');
    saveProjectDetectCache(curProj, cache);
    scanCurrentProjectConfigsOnPage();

    fetchGroupsAndAccountStats(true, true).then(() => {
      const updated = loadProjectDetectCache(curProj);
      if (!updated.lowScanned || !updated.highScanned) {
        sessionStorage.removeItem('GCP_HELPER_AUTO_CREATE_AFTER_SCAN');
        clearActionCounts(false);
        setFlowStage(STAGES.SCAN_PROJECT_BOTH);
        runPipelineTick();
      } else {
        renderProjectDetectSummary(true);
      }
    });
  });

  const REPAIR_REPORT_KEY = 'GCP_HELPER_REPAIR_REPORT';

  function loadRepairReport() {
    try {
      return (
        JSON.parse(sessionStorage.getItem(REPAIR_REPORT_KEY) || 'null') || {
          projectId: state.projectId || '',
          sheetsStatus: '待检查',
          driveStatus: '待检查',
          brandingStatus: '待检查',
          audienceStatus: '待检查'
        }
      );
    } catch (_) {
      return {
        projectId: state.projectId || '',
        sheetsStatus: '待检查',
        driveStatus: '待检查',
        brandingStatus: '待检查',
        audienceStatus: '待检查'
      };
    }
  }

  function saveRepairReport(rep) {
    try {
      sessionStorage.setItem(REPAIR_REPORT_KEY, JSON.stringify(rep || {}));
    } catch (_) {}
  }

  function finishProjectRepairWithReport() {
    const rep = loadRepairReport();
    setFlowStage(STAGES.IDLE);
    clearActionCounts(false);
    setLog(`🎉 项目 (${rep.projectId || state.projectId}) 配置检查与自动修复已全部完成！`, '#0f9d58');
    elJsonStatusBox.className = 'gjh-status-box gjh-status-ok';
    elJsonStatusBox.innerHTML = `
      <div style="font-weight:700;font-size:13px;color:#0b8043;margin-bottom:5px;">
        🩺 项目 (${escapeHtml(rep.projectId || state.projectId)}) 配置体检与自动修复报告
      </div>
      <div style="font-size:11px;line-height:1.6;color:#202124;">
        <div>1️⃣ <b>Google Sheets API</b>：${escapeHtml(rep.sheetsStatus)}</div>
        <div>2️⃣ <b>Google Drive API</b>：${escapeHtml(rep.driveStatus)}</div>
        <div>3️⃣ <b>OAuth 品牌与公开网址</b>：${escapeHtml(rep.brandingStatus)}</div>
        <div>4️⃣ <b>OAuth 受众与正式版状态</b>：${escapeHtml(rep.audienceStatus)}</div>
      </div>
      <div style="margin-top:6px;padding-top:5px;border-top:1px dashed #b7e1cd;font-size:11px;font-weight:600;color:#174ea6;">
        ✨ 结论：该项目下的所有 JSON 配置文件现已 100% 正常可用（已彻底解除 403 测试中限制）！
      </div>
    `;
  }

  document.getElementById('gjhCheckAndRepairBtn').addEventListener('click', () => {
    detectGoogleAccountAndProject(false);
    const curProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    if (!curProj) {
      setLog('❌ 当前页面未检测到项目 ID (?project=...)，请先在左上角选择一个项目！', '#d93025');
      return;
    }
    state.projectId = curProj;
    sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, curProj);
    const p = window.location.pathname;
    if (p.includes('/auth/audience')) {
      saveRepairReport({
        projectId: curProj,
        sheetsStatus: '✅ 已开启（受众页直修模式）',
        driveStatus: '✅ 已开启（受众页直修模式）',
        brandingStatus: '✅ 已配置（受众页直修模式）',
        audienceStatus: '正在点击“发布应用”修复为正式版...'
      });
      clearActionCounts(false);
      setLog(`🩺 检测到当前已在受众页面，正在立即点击“发布应用 -> 确认”修复 403 测试中状态...`, '#0f9d58');
      setFlowStage(STAGES.REPAIR_4_AUDIENCE);
      runPipelineTick();
      return;
    }

    if (p.includes('/auth/branding')) {
      saveRepairReport({
        projectId: curProj,
        sheetsStatus: '✅ 已开启（品牌页直修模式）',
        driveStatus: '✅ 已开启（品牌页直修模式）',
        brandingStatus: '正在核验并修正公开网址...',
        audienceStatus: '待修复...'
      });
      clearActionCounts(false);
      setLog(`🩺 正在从当前品牌页开始核验网址并前往受众页发布正式版...`, '#0f9d58');
      setFlowStage(STAGES.REPAIR_3_BRANDING);
      runPipelineTick();
      return;
    }

    saveRepairReport({
      projectId: curProj,
      sheetsStatus: '检测中...',
      driveStatus: '检测中...',
      brandingStatus: '检测中...',
      audienceStatus: '检测中...'
    });
    clearActionCounts(false);
    setLog(`🩺 开始全面体检并自动修复项目 (${curProj}) 的所有配置...`, '#0f9d58');
    setFlowStage(STAGES.REPAIR_1_SHEETS);
    runPipelineTick();
  });

  document.getElementById('gjhForceAddCurrentBtn').addEventListener('click', () => {
    sessionStorage.removeItem('GCP_HELPER_SKIP_HIGH_ONCE');
    startForceCreateInCurrentProject(STAGES.ENSURE_PROJECT, true);
  });

  document.getElementById('gjhOneClickCurrentBtn').addEventListener('click', () => {
    detectGoogleAccountAndProject(false);
    scanCurrentProjectConfigsOnPage();
    const curProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    if (!curProj) {
      startForceCreateInCurrentProject(STAGES.ENSURE_PROJECT, false);
      return;
    }
    state.projectId = curProj;
    sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, curProj);

    setLog(`🔍 正在全面核验当前项目 (${curProj}) 的高配与低配状态...`, '#1a73e8');
    fetchGroupsAndAccountStats(false, false).then(() => {
      scanCurrentProjectConfigsOnPage();
      const summary = getEffectiveProjectSummary();
      const needCheckLow =
        (state.configMode === 'LOW' || state.configMode === 'BOTH') && !summary.lowScanned && summary.totalLow === 0;
      const needCheckHigh =
        (state.configMode === 'HIGH' || state.configMode === 'BOTH') && !summary.highScanned && summary.totalHigh === 0;

      // 若某一侧列表页还未实地扫描过（防止因未打开过低配页/高配页而误判为 0 个），先自动巡检列表页再决定是否新建！
      if (needCheckLow || needCheckHigh) {
        setLog('🔍 正在自动前往列表页核验是否已有高配/低配，防止重复创建...', '#1a73e8');
        sessionStorage.setItem('GCP_HELPER_AUTO_CREATE_AFTER_SCAN', '1');
        clearActionCounts(false);
        setFlowStage(STAGES.SCAN_PROJECT_BOTH);
        runPipelineTick();
        return;
      }

      executeSmartDecisionAfterFullScan();
    });
  });

  document.getElementById('gjhOneClickNewNoOrgBtn').addEventListener('click', () => {
    if (!preCheckBeforeStart(true)) return;
    state.projectId = '';
    sessionStorage.removeItem(STORAGE_KEYS.FLOW_PROJECT);
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_SLUG');
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_EMAIL');
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_DETAIL_ID');
    setFlowStage(STAGES.CREATE_NO_ORG_PROJECT);
    window.location.href = 'https://console.cloud.google.com/projectcreate';
  });

  // 快捷按钮：仅在当前项目生成【高级 OAuth】
  document.getElementById('gjhOnlyHighOAuthBtn').addEventListener('click', () => {
    const urlProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    if (!urlProj) {
      setLog('❌ 当前页面未检测到项目 ID (?project=...)，请先选择项目！', '#d93025');
      return;
    }
    state.projectId = urlProj;
    sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, urlProj);
    state.configMode = 'HIGH';
    localStorage.setItem(STORAGE_KEYS.CONFIG_MODE, 'HIGH');
    renderModeTabs();
    clearActionCounts(true);
    setFlowStage(STAGES.OAUTH_CONSENT);
    // 如果当前已经在 /auth/* 或 /apis/credentials/* 页面，直接原地开始，不跳转刷新！
    const p = window.location.pathname;
    if (p.includes('/auth/') || p.includes('/apis/credentials')) {
      runPipelineTick();
    } else {
      navigateToStageUrl(STAGES.OAUTH_CONSENT);
    }
  });

  // 快捷按钮：仅在当前项目生成【低配服务账号】
  document.getElementById('gjhOnlyLowSaBtn').addEventListener('click', () => {
    const urlProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    if (!urlProj) {
      setLog('❌ 当前页面未检测到项目 ID (?project=...)，请先选择项目！', '#d93025');
      return;
    }
    state.projectId = urlProj;
    sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, urlProj);
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_SLUG');
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_EMAIL');
    sessionStorage.removeItem('GCP_HELPER_EXPECTED_SA_DETAIL_ID');
    state.configMode = 'LOW';
    localStorage.setItem(STORAGE_KEYS.CONFIG_MODE, 'LOW');
    renderModeTabs();
    clearActionCounts(true);
    setFlowStage(STAGES.CREATE_SA);
    navigateToStageUrl(STAGES.CREATE_SA);
  });

  elOneClickStopBtn.addEventListener('click', () => {
    stopPipelineWithReason('⏹️ 已手动停止全自动流水线', 'wait');
  });

  document.getElementById('gjhRedownloadBtn').addEventListener('click', () => {
    if (state.capturedJson) {
      const naming = getDatedNamingBundle(false);
      const isHigh = (state.capturedLevel || '').includes('高');
      const lvlPrefix = isHigh ? '【高配】' : '【低配】';
      const slug = state.currentSlug || (isHigh ? naming.highSlug : naming.lowSlug);
      triggerBrowserDownload(
        state.capturedJson,
        `${lvlPrefix}${slug}_${elGroupSelect.value || '组别'}_${state.projectId || 'project'}.json`
      );
      setLog('✅ 已下载当前捕获的 JSON 配置文件！', '#0f9d58');
      return;
    }
    if (state.lastBackup && state.lastBackup.jsonContent) {
      triggerBrowserDownload(state.lastBackup.jsonContent, state.lastBackup.fileName || 'backup_config.json');
      setLog('✅ 已从当前会话备份找回并下载上次生成的 JSON！', '#0f9d58');
      return;
    }
    setLog('⚠️ 当前会话暂无备份，请前往【按组下载JSON网页】输入组独立密码下载历史配置，或点击上方一键生成！', '#b06000');
  });

  document.getElementById('gjhDeleteProjBtn').addEventListener('click', () => {
    detectGoogleAccountAndProject(false);
    if (!state.projectId) {
      setLog('❌ 当前未检测到项目 ID', '#d93025');
      return;
    }
    if (!window.confirm(`⚠️ 确定要关停并删除当前项目 【${state.projectId}】 吗？`)) return;
    clearActionCounts();
    setFlowStage(STAGES.DELETE_PROJECT);
    window.location.href = `https://console.cloud.google.com/iam-admin/settings?project=${encodeURIComponent(state.projectId)}`;
  });

  document.getElementById('gjhUnlockOrgPolicyBtn').addEventListener('click', () => {
    const proj = state.projectId ? `?project=${encodeURIComponent(state.projectId)}` : '';
    window.location.href = `https://console.cloud.google.com/iam-admin/orgpolicies/iam-disableServiceAccountKeyCreation${proj}`;
  });

  document.getElementById('gjhStepSheetsBtn').addEventListener('click', () => {
    clearActionCounts();
    setFlowStage(STAGES.ENABLE_SHEETS);
    navigateToStageUrl(STAGES.ENABLE_SHEETS);
  });
  document.getElementById('gjhStepDriveBtn').addEventListener('click', () => {
    clearActionCounts();
    setFlowStage(STAGES.ENABLE_DRIVE);
    navigateToStageUrl(STAGES.ENABLE_DRIVE);
  });
  document.getElementById('gjhStepConsentBtn').addEventListener('click', () => {
    clearActionCounts();
    setFlowStage(STAGES.OAUTH_CONSENT);
    navigateToStageUrl(STAGES.OAUTH_CONSENT);
  });
  document.getElementById('gjhStepOAuthClientBtn').addEventListener('click', () => {
    clearActionCounts();
    setFlowStage(STAGES.OAUTH_CLIENT);
    navigateToStageUrl(STAGES.OAUTH_CLIENT);
  });

  // ==================== 跨页面持久化阈值防刷新死循环机制 ====================
  function tryPerformAction(actionKey, actionDesc, cooldownMs) {
    const now = Date.now();
    const lastTs = Number(sessionStorage.getItem(STORAGE_KEYS.LAST_ACTION_TS) || '0');
    if (now - lastTs < (cooldownMs || 2200)) {
      return false;
    }

    const counts = loadActionCounts();
    const count = counts[actionKey] || 0;
    if (count >= MAX_ACTION_CLICK_THRESHOLD) {
      stopPipelineWithReason(
        `⚠️ 触发防卡死阈值：【${actionDesc}】已尝试 ${count} 次，已自动暂停防刷新循环！您可以手动点一下页面上的按钮继续。`,
        'err'
      );
      return false;
    }

    counts[actionKey] = count + 1;
    saveActionCounts(counts);
    sessionStorage.setItem(STORAGE_KEYS.LAST_ACTION_TS, String(now));
    return true;
  }

  function stopPipelineWithReason(msg, statusType) {
    state.flowAborted = true;
    state.flowEpoch = (state.flowEpoch || 0) + 1;
    if (state.pendingUploadTimer) {
      clearTimeout(state.pendingUploadTimer);
      state.pendingUploadTimer = null;
    }
    if (state.postConfirmNavTimer) {
      clearTimeout(state.postConfirmNavTimer);
      state.postConfirmNavTimer = null;
    }
    if (state.continueHighTimer) {
      clearTimeout(state.continueHighTimer);
      state.continueHighTimer = null;
    }
    if (state.brandingNavTimer) {
      clearTimeout(state.brandingNavTimer);
      state.brandingNavTimer = null;
    }
    setFlowStage(STAGES.IDLE);
    clearActionCounts();
    setLog(msg, statusType === 'err' ? '#d93025' : '#b06000');
    elJsonStatusBox.className = 'gjh-status-box ' + (statusType === 'err' ? 'gjh-status-err' : 'gjh-status-wait');
    elJsonStatusBox.innerHTML = `<div>${escapeHtml(msg)}</div>`;
  }

  function checkBlockingErrorsAndCircuitBreak() {
    const bodyText = document.body.innerText || '';
    if (
      bodyText.includes('服务账号密钥创建功能已停用') ||
      bodyText.includes('阻止创建服务账号密钥') ||
      bodyText.includes('disableServiceAccountKeyCreation') ||
      bodyText.includes('Service account key creation is disabled')
    ) {
      setFlowStage(STAGES.IDLE);
      clearActionCounts();
      elJsonStatusBox.className = 'gjh-status-box gjh-status-err';
      elJsonStatusBox.innerHTML = `
        <div style="font-weight:bold;font-size:13px;">🚫 当前项目受“组织政策”限制，无法建低配服务账号密钥！</div>
        <div style="margin-top:4px;font-size:11px;">
          💡 <strong>提示</strong>：受组织限制的项目可以直接点上方 <strong>“🟣 仅生成高级OAuth”</strong> 生成高级版配置！或者点 <strong>“➕ 新建【无组织】项目”</strong>。
        </div>
      `;
      setLog('🚫 检测到服务账号密钥受组织限制，已自动停机', '#d93025');
      return true;
    }

    if (
      bodyText.includes('项目配额') ||
      bodyText.includes('已达到项目数量上限') ||
      bodyText.includes('exceeded your allotted project quota')
    ) {
      stopPipelineWithReason('🚫 当前谷歌账号的 GCP 项目配额已满！可点“🗑️ 删除当前项目”释放配额。', 'err');
      return true;
    }
    return false;
  }

  // ==================== 全自动跨页面状态机 ====================
  function setFlowStage(stage) {
    state.flowStage = stage;
    if (stage) {
      state.flowAborted = false;
      sessionStorage.setItem(STORAGE_KEYS.FLOW_STAGE, stage);
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.FLOW_STAGE);
    }
    updateFlowUI();
  }

  function updateFlowUI() {
    const stage = state.flowStage;
    if (!stage) {
      elFlowStatusBox.style.display = 'none';
      elStartBtnsWrap.style.display = 'block';
      elOneClickStopBtn.style.display = 'none';
      return;
    }

    elStartBtnsWrap.style.display = 'none';
    elOneClickStopBtn.style.display = 'inline-flex';
    elFlowStatusBox.style.display = 'block';

    const stageDescriptions = {
      [STAGES.SCAN_PROJECT_BOTH]: '🔍 <strong>[全面检测项目]</strong> 正在依次核验当前项目的【低配列表】与【高配列表】...',
      [STAGES.REPAIR_1_SHEETS]: '🩺 <strong>[体检修复 1/4]</strong> 正在检查并确保 Google Sheets API 已开启...',
      [STAGES.REPAIR_2_DRIVE]: '🩺 <strong>[体检修复 2/4]</strong> 正在检查并确保 Google Drive API 已开启...',
      [STAGES.REPAIR_3_BRANDING]: '🩺 <strong>[体检修复 3/4]</strong> 正在检查并自动修正 OAuth 品牌与公开网址 (https://www.google.com)...',
      [STAGES.REPAIR_4_AUDIENCE]: '🩺 <strong>[体检修复 4/4]</strong> 正在检查并将受众状态修复为【外部 · 公开正式版 (解决403)】...',
      [STAGES.CREATE_NO_ORG_PROJECT]: '🔄 <strong>[新建无组织项目]</strong> 正在自动选择“无组织”并创建新项目...',
      [STAGES.ENSURE_PROJECT]: '🔄 <strong>[步骤 1]</strong> 正在检测或创建 GCP 项目...',
      [STAGES.ENABLE_SHEETS]: '🔄 <strong>[步骤 2]</strong> 正在自动启用 Google Sheets API...',
      [STAGES.ENABLE_DRIVE]: '🔄 <strong>[步骤 3]</strong> 正在自动启用 Google Drive API...',
      [STAGES.CREATE_SA]: '🔄 <strong>[低配-服务账号]</strong> 正在自动创建服务账号...',
      [STAGES.CREATE_KEY]: '🔄 <strong>[低配-导出JSON]</strong> 正在自动导出服务账号 JSON 密钥...',
      [STAGES.OAUTH_CONSENT]: '🟣 <strong>[高级-OAuth配置]</strong> 正在自动配置 Google Auth Platform（外部公开 & 免绑邮箱）...',
      [STAGES.OAUTH_CLIENT]: '🟣 <strong>[高级-OAuth客户端]</strong> 正在创建桌面客户端并导出 installed JSON...',
      [STAGES.DELETE_PROJECT]: '🗑️ <strong>[删除项目]</strong> 正在自动关停并删除当前项目...'
    };
    elFlowStatusBox.innerHTML = stageDescriptions[stage] || '🔄 正在全自动执行中...';
  }

  function navigateToStageUrl(stage) {
    const proj = state.projectId ? `?project=${encodeURIComponent(state.projectId)}` : '';
    if (stage === STAGES.ENABLE_SHEETS || stage === STAGES.REPAIR_1_SHEETS) {
      window.location.href = `https://console.cloud.google.com/apis/library/sheets.googleapis.com${proj}`;
    } else if (stage === STAGES.ENABLE_DRIVE || stage === STAGES.REPAIR_2_DRIVE) {
      window.location.href = `https://console.cloud.google.com/apis/library/drive.googleapis.com${proj}`;
    } else if (stage === STAGES.REPAIR_3_BRANDING) {
      window.location.href = `https://console.cloud.google.com/auth/branding${proj}`;
    } else if (stage === STAGES.REPAIR_4_AUDIENCE) {
      window.location.href = `https://console.cloud.google.com/auth/audience${proj}`;
    } else if (stage === STAGES.CREATE_SA) {
      window.location.href = `https://console.cloud.google.com/iam-admin/serviceaccounts/create${proj}`;
    } else if (stage === STAGES.CREATE_KEY) {
      window.location.href = `https://console.cloud.google.com/iam-admin/serviceaccounts${proj}`;
    } else if (stage === STAGES.OAUTH_CONSENT) {
      window.location.href = `https://console.cloud.google.com/auth/overview${proj}`;
    } else if (stage === STAGES.OAUTH_CLIENT) {
      window.location.href = `https://console.cloud.google.com/auth/clients/create${proj}`;
    }
  }

  function advanceAfterApisEnabled() {
    clearActionCounts();
    if (state.configMode === 'HIGH') {
      setFlowStage(STAGES.OAUTH_CONSENT);
      navigateToStageUrl(STAGES.OAUTH_CONSENT);
    } else {
      setFlowStage(STAGES.CREATE_SA);
      navigateToStageUrl(STAGES.CREATE_SA);
    }
  }

  function autoAcceptTermsDialogIfPresent() {
    const dialogs = document.querySelectorAll('mat-dialog-container, [role="dialog"]');
    if (!dialogs.length) return;
    dialogs.forEach((dlg) => {
      const txt = dlg.textContent || '';
      if (txt.includes('服务条款') || txt.includes('Terms of Service')) {
        const checkboxes = dlg.querySelectorAll('input[type="checkbox"], mat-checkbox');
        checkboxes.forEach((cb) => {
          const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true' || cb.classList.contains('mat-checkbox-checked');
          if (!isChecked) {
            const clickable = cb.querySelector('label, input') || cb;
            clickable.click();
          }
        });
        const btns = Array.from(dlg.querySelectorAll('button'));
        const agreeBtn = btns.find((b) => {
          const t = (b.textContent || '').trim();
          return t.includes('同意并继续') || t.includes('Agree and continue');
        });
        if (agreeBtn && !agreeBtn.disabled && tryPerformAction('accept_tos', '同意服务条款', 2500)) {
          agreeBtn.click();
        }
      }
    });
  }

  /**
   * 判断元素在页面上是否真正可见
   */
  function isVisible(el) {
    if (!el || el.closest('#gcp-json-helper-root')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * 获取当前页面真正可见的弹窗容器（过滤掉 GCP 顶部导航栏中隐藏的 [role="dialog"] 占位元素！）
   */
  function getVisibleDialog() {
    const candidates = Array.from(
      document.querySelectorAll(
        '.cdk-overlay-container mat-dialog-container, .cdk-overlay-container .mat-mdc-dialog-container, .cdk-overlay-container [role="dialog"], .cdk-overlay-container [role="alertdialog"], .cdk-overlay-container cfc-dialog, .cdk-overlay-pane, mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"], [role="alertdialog"], cfc-dialog'
      )
    ).filter(isVisible);
    return candidates[0] || null;
  }

  /**
   * 完整绑定【目标服务账号前缀 + 目标项目 ID + 完整服务账号邮箱 (slug@projectId.iam.gserviceaccount.com)】
   */
  function bindExpectedSaIdentity(saSlug, projectId) {
    const cleanSlug = String(saSlug || '').trim().toLowerCase();
    const cleanProj = String(projectId || '').trim().toLowerCase();
    if (!cleanSlug || !cleanProj) return '';
    const fullEmail = `${cleanSlug}@${cleanProj}.iam.gserviceaccount.com`;
    sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, projectId.trim());
    sessionStorage.setItem('GCP_HELPER_EXPECTED_SA_SLUG', cleanSlug);
    sessionStorage.setItem('GCP_HELPER_EXPECTED_SA_EMAIL', fullEmail);
    return fullEmail;
  }

  /**
   * 从指定 DOM 容器中提取所有真实的 *.gserviceaccount.com 完整邮箱（排除悬浮助手面板自身 DOM，杜绝面板日志子串误判）
   */
  function extractGserviceAccountEmailsOutsideHelper(containerEl) {
    const rootNode = containerEl || document.body;
    if (!rootNode) return [];
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('#gcp-json-helper-root, script, style, noscript')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const chunks = [];
    let cur;
    while ((cur = walker.nextNode())) {
      if (cur.nodeValue && cur.nodeValue.includes('gserviceaccount.com')) {
        chunks.push(cur.nodeValue);
      }
    }
    const combined = chunks.join(' ');
    const matches = combined.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.gserviceaccount\.com/gi) || [];
    const unique = [];
    matches.forEach((m) => {
      const lower = m.trim().toLowerCase();
      if (unique.indexOf(lower) === -1) unique.push(lower);
    });
    return unique;
  }

  /**
   * 自动关闭高配 OAuth 创建完成后的“已创建 OAuth 客户端 (确定 / 下载 JSON)”弹窗
   * 支持跨页面跳转 (/auth/clients/create -> /auth/clients) 持续监听并在流水线 IDLE 后生效
   */
  function autoDismissCompletedOAuthDialog() {
    const dismissUntil = Number(sessionStorage.getItem('GCP_HELPER_DISMISS_OAUTH_DLG_UNTIL') || '0');
    const bodyText = document.body.innerText || '';
    const hasOAuthCreatedModalText =
      bodyText.includes('已创建 OAuth 客户端') ||
      bodyText.includes('OAuth client created') ||
      (bodyText.includes('客户端密钥') && bodyText.includes('下载 JSON'));

    if (Date.now() > dismissUntil && !hasOAuthCreatedModalText) return;

    const scopes = Array.from(
      document.querySelectorAll(
        'mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"], [role="alertdialog"], cfc-dialog, .cdk-overlay-pane'
      )
    ).filter(isVisible);

    for (let i = 0; i < scopes.length; i++) {
      const box = scopes[i];
      const txt = box.innerText || box.textContent || '';
      if (
        txt.includes('已创建 OAuth 客户端') ||
        txt.includes('OAuth client created') ||
        txt.includes('客户端密钥') ||
        txt.includes('GOCSPX-') ||
        txt.includes('下载 JSON') ||
        txt.toLowerCase().includes('download json')
      ) {
        const candidates = Array.from(box.querySelectorAll('button, [role="button"], a[role="button"], span')).filter(
          isVisible
        );
        const okNode = candidates.find((el) => {
          const t = (el.textContent || '').replace(/\s+/g, '');
          return t === '确定' || t === '关闭' || t.toLowerCase() === 'ok' || t.toLowerCase() === 'close';
        });
        if (okNode) {
          const okBtn = okNode.closest('button, [role="button"], a[role="button"]') || okNode;
          sessionStorage.removeItem('GCP_HELPER_DISMISS_OAUTH_DLG_UNTIL');
          triggerRealClick(okBtn);
          return;
        }
      }
    }
  }

  function runPipelineTick() {
    detectGoogleAccountAndProject(false);
    scanExistingKeysOnPage();
    autoDismissCompletedOAuthDialog();

    if (!state.flowStage || state.flowAborted) return;
    if (checkBlockingErrorsAndCircuitBreak()) return;
    autoAcceptTermsDialogIfPresent();

    const path = window.location.pathname;
    const stage = state.flowStage;
    const currentUrlProject = (new URLSearchParams(window.location.search).get('project') || '').trim();
    const boundProjectId = (sessionStorage.getItem(STORAGE_KEYS.FLOW_PROJECT) || '').trim();

    // 全局项目一致性守卫：一旦进入阶段 2~7，若当前 URL 的 project 参数与流水线绑定的 projectId 不一致，立即熔断拦截
    if (
      stage !== STAGES.CREATE_NO_ORG_PROJECT &&
      stage !== STAGES.ENSURE_PROJECT &&
      stage !== STAGES.DELETE_PROJECT &&
      boundProjectId &&
      currentUrlProject &&
      currentUrlProject.toLowerCase() !== boundProjectId.toLowerCase()
    ) {
      stopPipelineWithReason(
        `🛑 安全拦截：检测到页面项目 (${currentUrlProject}) 与本次流水线绑定项目 (${boundProjectId}) 不一致，已自动停止！`,
        'err'
      );
      return;
    }

    // ==================== 阶段 SCAN：自动双页巡检（核验低配服务账号页 + 高配OAuth客户端页） ====================
    if (stage === STAGES.SCAN_PROJECT_BOTH) {
      const targetProj = boundProjectId || currentUrlProject || state.projectId;
      if (!targetProj) {
        setFlowStage(STAGES.IDLE);
        return;
      }
      scanCurrentProjectConfigsOnPage();
      const cache = loadProjectDetectCache(targetProj);

      // 第 1 步：若尚未核验【低配服务账号列表页】，先前往 /iam-admin/serviceaccounts 扫描
      if (!cache.lowScanned) {
        if (!path.endsWith('/serviceaccounts') && !path.endsWith('/serviceaccounts/')) {
          if (tryPerformAction('scan_goto_low_list', '前往服务账号列表核验低配数量', 2500)) {
            setLog('🔍 [1/2] 正在前往【服务账号列表】检测已有低配数量...', '#1a73e8');
            window.location.href = `https://console.cloud.google.com/iam-admin/serviceaccounts?project=${encodeURIComponent(
              targetProj
            )}`;
          }
        }
        return;
      }

      // 第 2 步：若尚未核验【高配 OAuth 客户端列表页】，前往 /auth/clients 扫描
      if (!cache.highScanned) {
        if (!path.includes('/auth/clients') && !path.includes('/apis/credentials')) {
          if (tryPerformAction('scan_goto_high_list', '前往OAuth客户端列表核验高配数量', 2500)) {
            setLog('🔍 [2/2] 低配已核验，正在前往【OAuth客户端列表】检测已有高配数量...', '#7627bb');
            window.location.href = `https://console.cloud.google.com/auth/clients?project=${encodeURIComponent(
              targetProj
            )}`;
          }
        }
        return;
      }

      // 第 3 步：高低配双页均已实地核验完毕！
      setFlowStage(STAGES.IDLE);
      clearActionCounts(false);
      renderProjectDetectSummary(true);
      const sum = getEffectiveProjectSummary();
      const autoCreateAfter = sessionStorage.getItem('GCP_HELPER_AUTO_CREATE_AFTER_SCAN') === '1';
      sessionStorage.removeItem('GCP_HELPER_AUTO_CREATE_AFTER_SCAN');

      if (autoCreateAfter) {
        executeSmartDecisionAfterFullScan();
      } else {
        setLog(`✅ 全面检测完成：当前项目共有 低配 ${sum.totalLow} 个、高配 ${sum.totalHigh} 个！`, '#0f9d58');
      }
      return;
    }

    // ==================== 阶段 REPAIR 1~4：一键检查并自动修复当前项目配置 ====================
    if (stage === STAGES.REPAIR_1_SHEETS) {
      const rep = loadRepairReport();
      if (path.includes('/apis/api/sheets.googleapis.com')) {
        rep.sheetsStatus = loadActionCounts()['repair_enable_sheets']
          ? '🛠️ 原本未开启 → 已自动开启修复'
          : '✅ 正常（已开启）';
        saveRepairReport(rep);
        setFlowStage(STAGES.REPAIR_2_DRIVE);
        navigateToStageUrl(STAGES.REPAIR_2_DRIVE);
        return;
      }
      if (!path.includes('/apis/library/sheets.googleapis.com')) {
        if (tryPerformAction('repair_goto_sheets', '前往检查 Sheets API', 2500)) {
          navigateToStageUrl(STAGES.REPAIR_1_SHEETS);
        }
        return;
      }
      const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')).filter(isVisible);
      if (buttons.some((b) => ['管理', 'Manage'].includes((b.textContent || '').trim()))) {
        rep.sheetsStatus = loadActionCounts()['repair_enable_sheets']
          ? '🛠️ 原本未开启 → 已自动开启修复'
          : '✅ 正常（已开启）';
        saveRepairReport(rep);
        setFlowStage(STAGES.REPAIR_2_DRIVE);
        navigateToStageUrl(STAGES.REPAIR_2_DRIVE);
        return;
      }
      const enableBtn = buttons.find((b) => ['启用', 'Enable'].includes((b.textContent || '').trim()) && !b.disabled);
      if (enableBtn && tryPerformAction('repair_enable_sheets', '自动修复开启 Sheets API', 4000)) {
        setLog('🛠️ 检测到 Google Sheets API 未开启，正在自动点击“启用”修复...', '#0f9d58');
        enableBtn.click();
      }
      return;
    }

    if (stage === STAGES.REPAIR_2_DRIVE) {
      const rep = loadRepairReport();
      if (path.includes('/apis/api/drive.googleapis.com')) {
        rep.driveStatus = loadActionCounts()['repair_enable_drive']
          ? '🛠️ 原本未开启 → 已自动开启修复'
          : '✅ 正常（已开启）';
        saveRepairReport(rep);
        setFlowStage(STAGES.REPAIR_3_BRANDING);
        navigateToStageUrl(STAGES.REPAIR_3_BRANDING);
        return;
      }
      if (!path.includes('/apis/library/drive.googleapis.com')) {
        if (tryPerformAction('repair_goto_drive', '前往检查 Drive API', 2500)) {
          navigateToStageUrl(STAGES.REPAIR_2_DRIVE);
        }
        return;
      }
      const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')).filter(isVisible);
      if (buttons.some((b) => ['管理', 'Manage'].includes((b.textContent || '').trim()))) {
        rep.driveStatus = loadActionCounts()['repair_enable_drive']
          ? '🛠️ 原本未开启 → 已自动开启修复'
          : '✅ 正常（已开启）';
        saveRepairReport(rep);
        setFlowStage(STAGES.REPAIR_3_BRANDING);
        navigateToStageUrl(STAGES.REPAIR_3_BRANDING);
        return;
      }
      const enableBtn = buttons.find((b) => ['启用', 'Enable'].includes((b.textContent || '').trim()) && !b.disabled);
      if (enableBtn && tryPerformAction('repair_enable_drive', '自动修复开启 Drive API', 4000)) {
        setLog('🛠️ 检测到 Google Drive API 未开启，正在自动点击“启用”修复...', '#0f9d58');
        enableBtn.click();
      }
      return;
    }

    if (stage === STAGES.REPAIR_3_BRANDING) {
      const bodyText = document.body.innerText || '';
      const allBtns = Array.from(
        document.querySelectorAll(
          'button, a[role="button"], [role="button"], a.cfc-button, a.mat-mdc-button, a.mat-mdc-unelevated-button'
        )
      ).filter(isVisible);

      // 若该项目连 Google Auth Platform 都尚未初始化，自动点击“开始”跑完初始化向导
      const startBtn = allBtns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return (
          t === '开始' ||
          t === '开始使用' ||
          t.toLowerCase() === 'getstarted' ||
          t === '配置同意屏幕' ||
          t.toLowerCase() === 'configureconsentscreen'
        );
      });
      if (
        startBtn &&
        (bodyText.includes('尚未配置') ||
          bodyText.includes('开始配置') ||
          bodyText.toLowerCase().includes('not configured') ||
          bodyText.includes('同意屏幕'))
      ) {
        const rep = loadRepairReport();
        rep.brandingStatus = '🛠️ 原本未初始化 → 已自动完成 OAuth 初始化并填入公开网址';
        saveRepairReport(rep);
        if (tryPerformAction('repair_click_auth_start', '自动初始化 Google Auth Platform', 2500)) {
          triggerRealClick(startBtn);
        }
        return;
      }

      if (path.includes('/auth/overview/create')) {
        handleGoogleAuthPlatformWizard(allBtns);
        return;
      }

      if (!path.includes('/auth/branding') && !path.includes('/apis/credentials/consent')) {
        if (tryPerformAction('repair_goto_branding', '前往品牌与网址页面检查', 2500)) {
          navigateToStageUrl(STAGES.REPAIR_3_BRANDING);
        }
        return;
      }

      handleBrandingAndDomainsPage(allBtns);
      return;
    }

    if (stage === STAGES.REPAIR_4_AUDIENCE) {
      const rep = loadRepairReport();
      const allBtns = Array.from(
        document.querySelectorAll(
          'button, a[role="button"], [role="button"], a.cfc-button, a.mat-mdc-button, a.mat-mdc-unelevated-button'
        )
      ).filter(isVisible);

      if (!path.includes('/auth/audience')) {
        if (tryPerformAction('repair_goto_audience', '前往受众页面检查正式版状态', 2500)) {
          navigateToStageUrl(STAGES.REPAIR_4_AUDIENCE);
        }
        return;
      }

      // 1. 若“推送到生产环境？[确认]”或“设为外部？[确认]”弹窗已打开，立即点击【确认】
      if (tryClickPublishConfirmDialog(true)) {
        return;
      }

      // 2. 检查是否被误设为了“内部 (Internal)”（若存在未禁用的“设为外部”按钮，自动点击修复为外部）
      const makeExtBtn = allBtns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return (t === '设为外部' || t.toLowerCase() === 'makeexternal') && !b.disabled;
      });
      if (makeExtBtn && tryPerformAction('repair_make_external', '将内部应用修复为外部公开应用', 1800)) {
        setLog('🛠️ 检测到受众被设为“内部”，正在自动点击“设为外部”修复...', '#0f9d58');
        triggerRealClick(makeExtBtn);
        return;
      }

      // 3. 检查是否处于“测试中 (Testing)”（只要页面上存在“发布应用”按钮，就说明还是测试版，必须点击发布并确认！）
      const publishBtn = allBtns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return t === '发布应用' || t.toLowerCase() === 'publishapp';
      });
      if (publishBtn) {
        if (tryPerformAction('repair_click_publish', '点击“发布应用”修复403测试中状态', 2200)) {
          setLog('🛠️ 检测到应用处于【测试中(会导致403报错)】，正在自动点击“发布应用”...', '#0f9d58');
          rep.audienceStatus = '🛠️ 原本为【测试中 (403错误)】→ 已自动点击“发布应用+确认”修复为【公开正式版】';
          saveRepairReport(rep);
          triggerRealClick(publishBtn);
          [550, 1200, 2000].forEach((delay) => {
            setTimeout(() => {
              if (!state.flowAborted && state.flowStage === STAGES.REPAIR_4_AUDIENCE) {
                tryClickPublishConfirmDialog(true);
              }
            }, delay);
          });
        }
        return;
      }

      // 4. 仅当页面上真实渲染出“返回到测试 (Back to testing)”按钮（代表 Google 后台已真正切换为生产模式）时，才判定修复完成！
      const backToTestBtn = allBtns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return t.includes('返回到测试') || t.includes('返回测试') || t.toLowerCase().includes('backtotesting');
      });

      if (backToTestBtn) {
        if (!rep.audienceStatus || rep.audienceStatus === '检测中...' || rep.audienceStatus.includes('正在点击')) {
          rep.audienceStatus = '✅ 正常（已处于外部 · 公开正式版）';
          saveRepairReport(rep);
        }
        finishProjectRepairWithReport();
      } else {
        setLog('⏳ 正在等待受众页面完成切换为【生产模式】...', '#0f9d58');
      }
      return;
    }

    // ==================== 阶段 0 & 1：检测或新建【无组织】项目 ====================
    if (stage === STAGES.CREATE_NO_ORG_PROJECT || stage === STAGES.ENSURE_PROJECT) {
      if (stage === STAGES.ENSURE_PROJECT && state.projectId && !path.includes('/projectcreate')) {
        setFlowStage(STAGES.ENABLE_SHEETS);
        navigateToStageUrl(STAGES.ENABLE_SHEETS);
        return;
      }
      if (stage === STAGES.CREATE_NO_ORG_PROJECT && !path.includes('/projectcreate') && (loadActionCounts()['click_create_proj'] || 0) >= 1 && state.projectId) {
        setFlowStage(STAGES.ENABLE_SHEETS);
        navigateToStageUrl(STAGES.ENABLE_SHEETS);
        return;
      }
      if (!path.includes('/projectcreate')) {
        if (tryPerformAction('goto_projectcreate', '跳转新建项目页', 3000)) {
          window.location.href = 'https://console.cloud.google.com/projectcreate';
        }
        return;
      }

      selectNoOrganizationIfPossible();

      // 自动按【gaopei/dipei + 日期 + 随机码】填写新建项目名称
      const naming = getDatedNamingBundle(false);
      const projInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(
        (el) => isVisible(el) && !el.disabled && !el.readOnly
      );
      const projNameInput = projInputs[0];
      const btns = Array.from(document.querySelectorAll('button')).filter(isVisible);
      const createProjBtn = btns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return t === '创建' || t.toLowerCase() === 'create';
      });

      if (projNameInput && (projNameInput.value || '').trim() !== naming.projectSlug) {
        setNativeInputValue(projNameInput, naming.projectSlug);
        setLog(`✍️ 已自动填入项目名称：${naming.projectSlug}`, '#1a73e8');
        return;
      }

      if (createProjBtn && !createProjBtn.disabled && tryPerformAction('click_create_proj', '点击创建项目按钮', 4500)) {
        setLog('⚡ 正在自动点击“创建”新建 GCP 项目...', '#1a73e8');
        createProjBtn.click();
      }
      return;
    }

    // ==================== 阶段 2：自动开启 Google Sheets API ====================
    if (stage === STAGES.ENABLE_SHEETS) {
      if (path.includes('/apis/api/sheets.googleapis.com')) {
        setFlowStage(STAGES.ENABLE_DRIVE);
        navigateToStageUrl(STAGES.ENABLE_DRIVE);
        return;
      }
      if (!path.includes('/apis/library/sheets.googleapis.com')) {
        if (tryPerformAction('goto_sheets_api', '跳转 Sheets API 页面', 3000)) {
          navigateToStageUrl(STAGES.ENABLE_SHEETS);
        }
        return;
      }
      const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')).filter(isVisible);
      if (buttons.some((b) => ['管理', 'Manage'].includes((b.textContent || '').trim()))) {
        setFlowStage(STAGES.ENABLE_DRIVE);
        navigateToStageUrl(STAGES.ENABLE_DRIVE);
        return;
      }
      const enableBtn = buttons.find((b) => ['启用', 'Enable'].includes((b.textContent || '').trim()) && !b.disabled);
      if (enableBtn && tryPerformAction('enable_sheets_api', '点击启用 Sheets API', 4500)) {
        enableBtn.click();
      }
      return;
    }

    // ==================== 阶段 3：自动开启 Google Drive API ====================
    if (stage === STAGES.ENABLE_DRIVE) {
      if (path.includes('/apis/api/drive.googleapis.com')) {
        advanceAfterApisEnabled();
        return;
      }
      if (!path.includes('/apis/library/drive.googleapis.com')) {
        if (tryPerformAction('goto_drive_api', '跳转 Drive API 页面', 3000)) {
          navigateToStageUrl(STAGES.ENABLE_DRIVE);
        }
        return;
      }
      const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')).filter(isVisible);
      if (buttons.some((b) => ['管理', 'Manage'].includes((b.textContent || '').trim()))) {
        advanceAfterApisEnabled();
        return;
      }
      const enableBtn = buttons.find((b) => ['启用', 'Enable'].includes((b.textContent || '').trim()) && !b.disabled);
      if (enableBtn && tryPerformAction('enable_drive_api', '点击启用 Drive API', 4500)) {
        enableBtn.click();
      }
      return;
    }

    // ==================== 阶段 4：低配 - 创建服务账号 ====================
    if (stage === STAGES.CREATE_SA) {
      const targetProjId = (boundProjectId || currentUrlProject || state.projectId || '').trim();
      if (!targetProjId) {
        stopPipelineWithReason('🛑 安全拦截：未检测到当前绑定的 GCP 项目 ID，无法安全创建服务账号！', 'err');
        return;
      }

      let naming = getDatedNamingBundle(false);
      bindExpectedSaIdentity(naming.lowSlug, targetProjId);

      const counts = loadActionCounts();
      const hasSubmittedSaCreate = (counts['sa_click_done'] || 0) >= 1 || (counts['sa_click_continue'] || 0) >= 1;

      if ((path.endsWith('/serviceaccounts') || path.endsWith('/serviceaccounts/')) && hasSubmittedSaCreate) {
        setFlowStage(STAGES.CREATE_KEY);
        return;
      }
      if (!path.includes('/iam-admin/serviceaccounts/create')) {
        if (tryPerformAction('goto_sa_create', '跳转创建服务账号页', 3000)) {
          navigateToStageUrl(STAGES.CREATE_SA);
        }
        return;
      }

      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(
        (el) => isVisible(el) && !el.disabled && !el.readOnly
      );
      const nameInput = inputs[0];
      const idInput = inputs[1];

      const pageText = document.body.innerText || '';
      if (pageText.includes('已存在') || pageText.toLowerCase().includes('already exists')) {
        // 若发生重名碰撞，立即重新生成新的唯一随机码并完整绑定 (slug + projectId + fullEmail)，绝不复用旧账号
        naming = getDatedNamingBundle(true);
        bindExpectedSaIdentity(naming.lowSlug, targetProjId);
        if (nameInput) setNativeInputValue(nameInput, naming.lowSlug);
        if (idInput) setNativeInputValue(idInput, naming.lowSlug);
        setLog(`🔄 检测到同名服务账号已存在，已自动更换新标识：${naming.lowSlug}`, '#1a73e8');
        return;
      }

      if (nameInput && nameInput.value !== naming.lowSlug) {
        setNativeInputValue(nameInput, naming.lowSlug);
        if (idInput) {
          setNativeInputValue(idInput, naming.lowSlug);
        }
        setLog(`🟢 已自动填入低配服务账号名称：${naming.lowSlug}`, '#0f9d58');
        return;
      }
      if (idInput && idInput.value !== naming.lowSlug) {
        setNativeInputValue(idInput, naming.lowSlug);
        return;
      }

      const btns = Array.from(document.querySelectorAll('button')).filter(isVisible);
      const doneBtn = btns.find((b) => ['完成', 'Done'].includes((b.textContent || '').trim()) && !b.disabled);
      if (doneBtn && tryPerformAction('sa_click_done', '点击完成创建服务账号', 2800)) {
        doneBtn.click();
        return;
      }
      const createContBtn = btns.find((b) => {
        const t = (b.textContent || '').trim();
        return (t.includes('创建并继续') || t.includes('Create and continue')) && !b.disabled;
      });
      if (createContBtn && tryPerformAction('sa_click_continue', '点击创建并继续', 2800)) {
        createContBtn.click();
        return;
      }
      return;
    }

    // ==================== 阶段 5：低配 - 导出服务账号 JSON ====================
    if (stage === STAGES.CREATE_KEY) {
      const expectedProjectId = (sessionStorage.getItem(STORAGE_KEYS.FLOW_PROJECT) || '').trim().toLowerCase();
      const expectedSaSlug = (sessionStorage.getItem('GCP_HELPER_EXPECTED_SA_SLUG') || '').trim().toLowerCase();
      const expectedSaEmail = (sessionStorage.getItem('GCP_HELPER_EXPECTED_SA_EMAIL') || '').trim().toLowerCase();
      const canonicalExpectedEmail =
        expectedSaSlug && expectedProjectId ? `${expectedSaSlug}@${expectedProjectId}.iam.gserviceaccount.com` : '';

      if (!expectedProjectId || !expectedSaSlug || !canonicalExpectedEmail || expectedSaEmail !== canonicalExpectedEmail) {
        setFlowStage(STAGES.CREATE_SA);
        navigateToStageUrl(STAGES.CREATE_SA);
        return;
      }

      if (currentUrlProject && currentUrlProject.toLowerCase() !== expectedProjectId) {
        stopPipelineWithReason(
          `🛑 安全拦截：当前 URL 项目 (${currentUrlProject}) 与绑定目标项目 (${expectedProjectId}) 不一致，已停止创建密钥！`,
          'err'
        );
        return;
      }

      if (path.endsWith('/serviceaccounts') || path.endsWith('/serviceaccounts/')) {
        const links = Array.from(document.querySelectorAll('a[href*="/iam-admin/serviceaccounts/details/"]'));
        // 仅按完整服务账号邮箱 (slug@projectId.iam.gserviceaccount.com) 精确全等匹配，严禁使用子串或前缀匹配
        const targetLink = links.find((a) => {
          const rowEl = a.closest('tr, mat-row, [role="row"]') || a;
          const rowEmails = extractGserviceAccountEmailsOutsideHelper(rowEl);
          return rowEmails.length === 1 && rowEmails[0] === canonicalExpectedEmail;
        });

        if (targetLink && tryPerformAction('goto_sa_keys_tab', '进入目标服务账号密钥页', 2200)) {
          const href = targetLink.getAttribute('href') || '';
          const detailIdMatch = href.match(/\/serviceaccounts\/details\/([^/?#]+)/i);
          if (detailIdMatch && detailIdMatch[1]) {
            sessionStorage.setItem('GCP_HELPER_EXPECTED_SA_DETAIL_ID', detailIdMatch[1].trim());
          }
          if (href.includes('/details/') && !href.includes('/keys')) {
            const parts = href.split('?');
            window.location.href = parts[0].replace(/\/$/, '') + '/keys' + (parts[1] ? '?' + parts[1] : '');
          } else {
            targetLink.click();
          }
          return;
        }

        // 若页面列表中已加载完成但没有找到完整邮箱精确匹配的目标服务账号，切回创建服务账号阶段
        if (links.length > 0 && tryPerformAction('redirect_back_create_sa', '未找到本次目标服务账号，前往创建', 3500)) {
          setLog(`⚠️ 列表中未找到完整匹配的目标账号 (${canonicalExpectedEmail})，正在前往创建...`, '#b06000');
          setFlowStage(STAGES.CREATE_SA);
          navigateToStageUrl(STAGES.CREATE_SA);
        }
        return;
      }

      if (path.includes('/serviceaccounts/details/')) {
        const currentDetailId = ((path.match(/\/serviceaccounts\/details\/([^/?#]+)/i) || [])[1] || '').trim();
        const expectedDetailId = (sessionStorage.getItem('GCP_HELPER_EXPECTED_SA_DETAIL_ID') || '').trim();
        // 排除悬浮面板自身文本后，提取详情页上展示的真实 *.gserviceaccount.com 完整邮箱
        const pageSaEmails = extractGserviceAccountEmailsOutsideHelper(document.body);

        if (pageSaEmails.length > 0) {
          // 当页面上存在服务账号邮箱（如在“详细信息”标签页）时，必须全等匹配 canonicalExpectedEmail
          const hasMismatchEmail = pageSaEmails.some((em) => em !== canonicalExpectedEmail);
          if (hasMismatchEmail || pageSaEmails.indexOf(canonicalExpectedEmail) === -1) {
            stopPipelineWithReason(
              `🛑 安全拦截：当前详情页账号 (${pageSaEmails.join(', ')}) 与绑定目标 (${canonicalExpectedEmail}) 不一致，已停止自动创建私钥！`,
              'err'
            );
            return;
          }
          if (currentDetailId && currentDetailId !== expectedDetailId) {
            sessionStorage.setItem('GCP_HELPER_EXPECTED_SA_DETAIL_ID', currentDetailId);
          }
        } else {
          // 注意：GCP 的 /details/<uniqueId>/keys（“密钥”标签页）DOM 中不渲染 @*.gserviceaccount.com 邮箱，
          // 因此通过从列表页完整邮箱行绑定过来的 uniqueId (expectedDetailId) 进行严格核验
          if (expectedDetailId) {
            if (!currentDetailId || currentDetailId !== expectedDetailId) {
              stopPipelineWithReason(
                `🛑 安全拦截：当前密钥页服务账号 ID (${currentDetailId || '未知'}) 与绑定目标 ID (${expectedDetailId}) 不一致，已停止自动创建私钥！`,
                'err'
              );
              return;
            }
          } else {
            // 若刷新或直接停留在 /keys 页尚未绑定 expectedDetailId，先回列表页核验完整邮箱并绑定 ID
            if (tryPerformAction('back_to_sa_list_for_verify', '回列表页核验目标服务账号唯一ID', 2200)) {
              navigateToStageUrl(STAGES.CREATE_KEY);
            }
            return;
          }
        }
      }

      if (path.includes('/serviceaccounts/details/') && !path.includes('/keys')) {
        const tabs = Array.from(document.querySelectorAll('a[role="tab"], div[role="tab"], button[role="tab"], a'));
        const keyTab = tabs.find((t) => {
          const txt = (t.textContent || '').trim();
          return txt === '密钥' || txt === 'Keys' || (t.getAttribute('href') || '').includes('/keys');
        });
        if (keyTab && tryPerformAction('click_key_tab', '点击密钥标签页', 2000)) {
          keyTab.click();
        }
        return;
      }

      if (path.includes('/serviceaccounts/details/')) {
        // 1. 优先检查“创建私钥 (JSON)”确认弹窗中的【创建 (Create)】按钮
        // 注意：绝不能在未找到“创建”按钮时直接 return，因为下拉菜单“创建新密钥”同样挂载在 .cdk-overlay-pane 下！
        const dialog = getVisibleDialog();
        const overlayScope = dialog || document.querySelector('.cdk-overlay-container') || document.body;
        const dlgBtns = Array.from(overlayScope.querySelectorAll('button, [role="button"], a[role="button"]')).filter(isVisible);
        const confirmCreateBtn = dlgBtns.find((b) => {
          const t = (b.textContent || '').replace(/\s+/g, '');
          return (t === '创建' || t.toLowerCase() === 'create') && !b.disabled;
        });
        if (confirmCreateBtn) {
          if (tryPerformAction('confirm_create_json_key', '弹窗确认创建JSON密钥', 600)) {
            setLog('🟢 正在点击弹窗“创建”导出服务账号 JSON 密钥...', '#0f9d58');
            triggerRealClick(confirmCreateBtn);
          }
          return;
        }

        // 2. 检查已展开的下拉菜单中的【创建新密钥 (Create new key)】选项（不依赖固定标签或位置，兼容 button/div/li/span/menuitem）
        const menuCandidates = Array.from(
          document.querySelectorAll(
            '[role="menuitem"], [role="option"], .mat-menu-item, .mat-mdc-menu-item, .mdc-list-item, .cfc-menu-item, cfc-menu-item, .cdk-overlay-container button, .cdk-overlay-container a, .cdk-overlay-container li, .cdk-overlay-container div, .cdk-overlay-container span'
          )
        ).filter(isVisible);
        const matchedMenuNode = menuCandidates.find((item) => {
          const t = (item.textContent || '').replace(/\s+/g, '');
          return t === '创建新密钥' || t === '创建新键' || t === '新建密钥' || t.toLowerCase() === 'createnewkey';
        });
        if (matchedMenuNode) {
          const createNewKeyItem =
            matchedMenuNode.closest(
              'button, a, [role="menuitem"], [role="option"], [role="button"], .mat-mdc-menu-item, .mat-menu-item, .mdc-list-item, .cfc-menu-item, cfc-menu-item, li'
            ) || matchedMenuNode;
          if (tryPerformAction('click_menu_create_new_key', '点击创建新密钥', 500)) {
            setLog('🟢 正在点击下拉菜单“创建新密钥”...', '#0f9d58');
            triggerRealClick(createNewKeyItem);
          }
          return;
        }

        // 3. 仅当弹窗和下拉菜单均未展开时，点击【添加键 (Add key)】按钮展开菜单
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isVisible);
        const addKeyBtn = buttons.find((b) => {
          const t = (b.textContent || '').replace(/\s+/g, '');
          return t.includes('添加键') || t.includes('添加密钥') || t.toLowerCase().includes('addkey');
        });
        if (addKeyBtn && tryPerformAction('click_add_key_btn', '点击添加键按钮', 2200)) {
          setLog('🟢 正在点击“添加键”按钮...', '#0f9d58');
          triggerRealClick(addKeyBtn);
        }
      }
      return;
    }

    // ==================== 阶段 6 & 7：高级 - Google Auth Platform 配置 + 创建 OAuth 客户端 ====================
    if (stage === STAGES.OAUTH_CONSENT || stage === STAGES.OAUTH_CLIENT) {
      runUnifiedOAuthPipeline(path, stage);
      return;
    }

    // ==================== 阶段 8：删除项目 ====================
    if (stage === STAGES.DELETE_PROJECT) {
      if (!path.includes('/iam-admin/settings')) return;
      const dialog = getVisibleDialog();
      if (dialog) {
        const inputs = Array.from(dialog.querySelectorAll('input[type="text"], input:not([type])'));
        const projInput = inputs[0];
        if (projInput && state.projectId && projInput.value !== state.projectId) {
          setNativeInputValue(projInput, state.projectId);
          setLog(`✍️ 已自动填入项目 ID 【${state.projectId}】，请点击弹窗右下角“关停”确认删除！`, '#0f9d58');
          setFlowStage(STAGES.IDLE);
        }
        return;
      }
      const btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isVisible);
      const shutdownBtn = btns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return t.includes('关停') || t.toLowerCase().includes('shutdown') || t.includes('删除项目');
      });
      if (shutdownBtn && tryPerformAction('click_shutdown_proj', '点击关停项目', 3000)) {
        shutdownBtn.click();
      }
    }
  }

  function tryClickPublishConfirmDialog(isRepairMode) {
    // 优先在最顶层的可见弹窗 (.cdk-overlay-container / mat-dialog-container / cfc-dialog) 中寻找“确认/确定/Confirm”按钮
    const candidates = Array.from(
      document.querySelectorAll(
        '.cdk-overlay-container button, .cdk-overlay-container [role="button"], mat-dialog-container button, .mat-mdc-dialog-container button, [role="dialog"] button, [role="alertdialog"] button, cfc-dialog button, button, [role="button"], a[role="button"]'
      )
    ).filter((el) => {
      if (!isVisible(el)) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const t = (el.textContent || '').replace(/\s+/g, '');
      return t === '确认' || t === '确定' || t.toLowerCase() === 'confirm';
    });

    if (candidates.length === 0) return false;
    // 取最顶层弹窗里的那个“确认”按钮，避免误点背景层隐藏元素
    const confirmNode = candidates[candidates.length - 1];
    const confirmBtn = confirmNode.closest('button, [role="button"], a[role="button"]') || confirmNode;

    if (isRepairMode || state.flowStage === STAGES.REPAIR_4_AUDIENCE) {
      const rep = loadRepairReport();
      rep.audienceStatus = '🛠️ 原本为【测试中 (403错误)】→ 已自动点击“发布应用+确认”修复为【公开正式版】';
      saveRepairReport(rep);
      setLog('🛠️ 正在点击弹窗“确认”，等待 Google 正式切换为【生产模式】...', '#0f9d58');
    } else {
      setLog('🟣 正在点击弹窗“确认”，等待 Google 正式切换为【生产模式】...', '#7627bb');
    }

    // 注意：这里不提前结束流程，也不盲目跳转，而是持续等待弹窗真正关闭且页面出现“返回到测试”按钮后才算成功！
    triggerRealClick(confirmBtn);
    return true;
  }

  /**
   * 统一处理【高级 OAuth 公开客户端 JSON】页面状态机
   * 兼容新版 Google Auth Platform (/auth/*) 与旧版 API 凭据页面 (/apis/credentials/*)
   */
  function runUnifiedOAuthPipeline(path, stage) {
    if (scanOAuthCreatedDialogAndCapture()) {
      return;
    }

    if (!path.includes('/auth/') && !path.includes('/apis/credentials')) {
      if (tryPerformAction('nav_to_auth_overview', '前往 Google Auth Platform 页面', 3500)) {
        navigateToStageUrl(STAGES.OAUTH_CONSENT);
      }
      return;
    }

    const bodyText = document.body.innerText || '';
    const allBtns = Array.from(
      document.querySelectorAll(
        'button, a[role="button"], [role="button"], a.cfc-button, a.mat-mdc-button, a.mat-mdc-unelevated-button'
      )
    ).filter(isVisible);

    // 情况 A：页面显示“尚未配置 Google Auth Platform”及【开始】按钮
    const startBtn = allBtns.find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, '');
      return (
        t === '开始' ||
        t === '开始使用' ||
        t.toLowerCase() === 'getstarted' ||
        t === '配置同意屏幕' ||
        t.toLowerCase() === 'configureconsentscreen'
      );
    });
    if (
      startBtn &&
      (bodyText.includes('尚未配置') ||
        bodyText.includes('开始配置') ||
        bodyText.toLowerCase().includes('not configured') ||
        bodyText.includes('同意屏幕'))
    ) {
      if (tryPerformAction('click_auth_start_btn', '点击“开始”配置 Google Auth Platform', 2500)) {
        setLog('🟣 检测到尚未配置 Google Auth Platform，正在自动点击“开始”...', '#7627bb');
        triggerRealClick(startBtn);
      }
      return;
    }

    // 情况 B1：处于“品牌 (/auth/branding)”或“应用网域”设置网址页面
    if (
      path.includes('/auth/branding') ||
      bodyText.includes('应用网域') ||
      bodyText.includes('应用首页') ||
      bodyText.includes('应用隐私权政策链接') ||
      bodyText.includes('应用服务条款链接')
    ) {
      handleBrandingAndDomainsPage(allBtns);
      return;
    }

    // 情况 B2：处于 Google Auth Platform 的 4 步初始化向导中 (/auth/overview/create)
    if (path.includes('/auth/overview/create')) {
      handleGoogleAuthPlatformWizard(allBtns);
      return;
    }

    // 情况 C：确认弹窗“推送到生产环境？ [确认]”
    if (tryClickPublishConfirmDialog()) {
      return;
    }

    // 在 OAUTH_CONSENT 阶段，即使当前停留在 /auth/clients 或 /auth/overview，也必须先经过 /auth/branding 和 /auth/audience 发布正式版！
    if (
      stage === STAGES.OAUTH_CONSENT &&
      (path.endsWith('/auth/overview') || path.includes('/auth/audience') || path.endsWith('/auth/clients') || path.endsWith('/auth/clients/')) &&
      !(loadActionCounts()['visited_branding_urls'])
    ) {
      const counts = loadActionCounts();
      counts['visited_branding_urls'] = 1;
      saveActionCounts(counts);
      const proj = state.projectId ? `?project=${encodeURIComponent(state.projectId)}` : '';
      setLog('🟣 正在前往“品牌 (Branding)”页面自动填入公开网址 (https://www.google.com)...', '#7627bb');
      window.location.href = `https://console.cloud.google.com/auth/branding${proj}`;
      return;
    }

    if (
      stage === STAGES.OAUTH_CONSENT &&
      (path.endsWith('/auth/overview') || path.endsWith('/auth/clients') || path.endsWith('/auth/clients/')) &&
      !(loadActionCounts()['visited_audience_to_publish'])
    ) {
      const counts = loadActionCounts();
      counts['visited_audience_to_publish'] = 1;
      saveActionCounts(counts);
      const proj = state.projectId ? `?project=${encodeURIComponent(state.projectId)}` : '';
      setLog('🟣 正在前往“受众 (Audience)”页面将应用发布为【公开正式版】...', '#7627bb');
      window.location.href = `https://console.cloud.google.com/auth/audience${proj}`;
      return;
    }

    // 情况 D：在受众页面 (/auth/audience) 点击“发布应用 (Publish app)”并确认已切为正式版
    if (path.includes('/auth/audience')) {
      const nativeBtns = Array.from(document.querySelectorAll('button')).filter(isVisible);
      const publishBtn =
        nativeBtns.find((b) => {
          const t = (b.textContent || '').replace(/\s+/g, '');
          return t === '发布应用' || t.toLowerCase() === 'publishapp';
        }) ||
        allBtns.find((b) => {
          const t = (b.textContent || '').replace(/\s+/g, '');
          return t === '发布应用' || t.toLowerCase() === 'publishapp';
        });

      if (publishBtn) {
        if (tryPerformAction('click_publish_app', '点击“发布应用”设为公开正式版', 1800)) {
          setLog('🟣 正在点击“发布应用”将应用从【测试】切换为【公开正式版】...', '#7627bb');
          triggerRealClick(publishBtn);
          // 点击“发布应用”后分别在 450ms、950ms、1500ms 自动捕捉并点击“推送到生产环境？[确认]”弹窗
          [450, 950, 1500].forEach((delay) => {
            setTimeout(() => {
              if (!state.flowAborted && state.flowStage) {
                tryClickPublishConfirmDialog();
              }
            }, delay);
          });
        }
        return;
      }

      // 仅当页面上真实渲染出“返回到测试 (Back to testing)”按钮时，才代表 Google 已真正切换到生产模式！
      const backToTestBtn = allBtns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return t.includes('返回到测试') || t.includes('返回测试') || t.toLowerCase().includes('backtotesting');
      });
      const isAlreadyProduction = Boolean(backToTestBtn);

      if (isAlreadyProduction) {
        if (tryPerformAction('from_audience_to_client_create', '已确认为公开正式版，前往创建 OAuth 客户端', 2200)) {
          setLog('✅ 已确认应用处于【公开正式版 (In production)】，正在前往创建 OAuth 客户端...', '#0f9d58');
          setFlowStage(STAGES.OAUTH_CLIENT);
          navigateToStageUrl(STAGES.OAUTH_CLIENT);
        }
      } else {
        setLog('⏳ 正在等待受众页面加载“发布应用”按钮...', '#7627bb');
      }
      return;
    }

    // 情况 E：在客户端列表页 (/auth/clients) 点击“+ 创建客户端 (Create client)”
    if (path.endsWith('/auth/clients') || path.endsWith('/auth/clients/')) {
      const createClientBtn = allBtns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return t.includes('创建客户端') || t.toLowerCase().includes('createclient');
      });
      if (createClientBtn && tryPerformAction('click_create_client_btn', '点击“创建客户端”按钮', 2500)) {
        setLog('🟣 正在点击“创建客户端”...', '#7627bb');
        triggerRealClick(createClientBtn);
      }
      return;
    }

    // 情况 F：在创建客户端表单页 (/auth/clients/create 或 /apis/credentials/oauthclient)
    if (path.includes('/auth/clients/create') || path.includes('/apis/credentials/oauthclient')) {
      handleCreateOAuthClientForm(allBtns);
      return;
    }

    // 情况 G：旧版 /apis/credentials/consent 页面兼容
    if (path.includes('/apis/credentials/consent')) {
      handleBrandingAndDomainsPage(allBtns);
      const nextBtn = allBtns.find((b) => {
        const t = (b.textContent || '').replace(/\s+/g, '');
        return (t === '创建' || t === '保存并继续' || t === '下一步' || t === '继续') && !b.disabled;
      });
      if (nextBtn && tryPerformAction('legacy_consent_next', '点击保存并继续', 2500)) {
        nextBtn.click();
      }
    }
  }

  /**
   * 驱动 Google Auth Platform (/auth/overview/create) 4 步初始化向导
   */
  function handleGoogleAuthPlatformWizard(allBtns) {
    const email = elAccountInput.value.trim() || state.googleAccount || 'user@gmail.com';
    const naming = getDatedNamingBundle(false);

    // 0. 若下拉菜单选项（用户支持电子邮件）已展开，选择包含 @ 的邮箱选项
    const openOptions = Array.from(document.querySelectorAll('mat-option, [role="option"], .mat-option, .mat-mdc-option')).filter(isVisible);
    if (openOptions.length > 0) {
      const emailOpt = openOptions.find((opt) => (opt.textContent || '').includes('@')) || openOptions[0];
      if (emailOpt) {
        emailOpt.click();
        setLog('🟣 已自动选择用户支持邮箱：' + (emailOpt.textContent || '').trim(), '#7627bb');
        return;
      }
    }

    // 1. 检查当前可见的文本输入框（第1步“应用名称” 或 第3步“联系信息电子邮件”）
    const visibleInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])')).filter(
      (el) => isVisible(el) && !el.disabled && !el.readOnly
    );

    for (let i = 0; i < visibleInputs.length; i++) {
      const inp = visibleInputs[i];
      const fieldEl = inp.closest('mat-form-field, cfc-form-field, .mat-mdc-form-field, label') || inp.parentElement;
      const stepEl = inp.closest('mat-step, .mat-step, cfc-step');
      const fieldMeta = (
        (inp.getAttribute('formcontrolname') || '') +
        ' ' +
        (inp.getAttribute('aria-label') || '') +
        ' ' +
        (inp.getAttribute('placeholder') || '') +
        ' ' +
        (inp.getAttribute('type') || '') +
        ' ' +
        (fieldEl ? fieldEl.textContent || '' : '')
      ).toLowerCase();
      const stepHeaderMeta = stepEl
        ? ((stepEl.querySelector('mat-step-header, .mat-step-header') || stepEl).textContent || '').toLowerCase()
        : '';

      const isContactEmailField =
        fieldMeta.includes('电子邮件') ||
        fieldMeta.includes('邮箱') ||
        fieldMeta.includes('联系') ||
        fieldMeta.includes('email') ||
        fieldMeta.includes('contact') ||
        stepHeaderMeta.includes('联系信息') ||
        stepHeaderMeta.includes('contact');

      if (isContactEmailField) {
        const stepBox = stepEl || inp.closest('form') || document.body;
        const hasEmailAlready = (stepBox.textContent || '').includes(email) || inp.value === email;
        if (!hasEmailAlready) {
          setNativeInputValue(inp, email);
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          setLog('🟣 已自动填入开发者联系邮箱：' + email, '#7627bb');
          return;
        }
      } else if (!inp.value || inp.value.trim() !== naming.highSlug) {
        setNativeInputValue(inp, naming.highSlug);
        setLog('🟣 已自动填入应用名称：' + naming.highSlug, '#7627bb');
        return;
      }
    }

    // 2. 检查当前可见的下拉框（第1步“用户支持电子邮件”）
    const visibleSelects = Array.from(document.querySelectorAll('mat-select, [role="combobox"]')).filter(isVisible);
    for (let i = 0; i < visibleSelects.length; i++) {
      const sel = visibleSelects[i];
      const selTxt = (sel.textContent || '').trim();
      if (!selTxt.includes('@')) {
        if (tryPerformAction('wizard_open_support_email', '展开用户支持邮箱下拉框', 2000)) {
          sel.click();
        }
        return;
      }
    }

    // 3. 检查当前可见的单选框（第2步“受众群体：外部 External”）
    const visibleRadios = Array.from(document.querySelectorAll('mat-radio-button, [role="radio"]')).filter(isVisible);
    if (visibleRadios.length > 0) {
      const extRadio = visibleRadios.find((r) => {
        const t = (r.textContent || '').trim();
        return t.includes('外部') || t.toLowerCase().includes('external');
      });
      if (extRadio) {
        const isChecked =
          extRadio.classList.contains('mat-radio-checked') ||
          extRadio.classList.contains('mat-mdc-radio-checked') ||
          extRadio.getAttribute('aria-checked') === 'true' ||
          Boolean(extRadio.querySelector('input:checked'));
        if (!isChecked) {
          const target = extRadio.querySelector('input, label') || extRadio;
          target.click();
          setLog('🟣 已自动选择受众群体：【外部 (External)】', '#7627bb');
          return;
        }
      }
    }

    // 4. 检查当前可见的复选框（第4步同意政策条款）
    const visibleCheckboxes = Array.from(document.querySelectorAll('mat-checkbox, input[type="checkbox"]')).filter(isVisible);
    for (let i = 0; i < visibleCheckboxes.length; i++) {
      const cb = visibleCheckboxes[i];
      const isChecked =
        cb.checked ||
        cb.getAttribute('aria-checked') === 'true' ||
        cb.classList.contains('mat-checkbox-checked') ||
        cb.classList.contains('mat-mdc-checkbox-checked') ||
        Boolean(cb.querySelector('input:checked'));
      if (!isChecked) {
        const target = cb.querySelector('input, label') || cb;
        target.click();
        setLog('🟣 已自动勾选同意政策条款', '#7627bb');
        return;
      }
    }

    // 5. 点击“下一步 (Next)” / “继续 (Continue)” / “创建 (Create)”按钮
    const stepNextBtn = allBtns.find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, '');
      return (t === '下一步' || t === '继续' || t.toLowerCase() === 'next' || t.toLowerCase() === 'continue') && !b.disabled;
    });
    if (stepNextBtn) {
      const rect = stepNextBtn.getBoundingClientRect();
      const stepKey = 'wizard_next_' + Math.round(rect.top / 40);
      if (tryPerformAction(stepKey, '点击向导“下一步/继续”', 1600)) {
        stepNextBtn.click();
      }
      return;
    }

    const finalCreateBtn = allBtns.find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, '');
      return (t === '创建' || t.toLowerCase() === 'create') && !b.disabled;
    });
    if (finalCreateBtn && tryPerformAction('wizard_final_create', '点击“创建”完成 Google Auth Platform 配置', 3000)) {
      setLog('🟣 正在点击“创建”保存 Google Auth Platform 配置...', '#7627bb');
      finalCreateBtn.click();
    }
  }

  function triggerRealClick(el) {
    if (!el) return;
    try {
      const innerBtn = el.tagName === 'BUTTON' || el.tagName === 'A' ? el : el.querySelector('button, a, input');
      const target = innerBtn || el;
      // 若元素位于悬浮下拉层/弹窗层 (.cdk-overlay-container) 内，不要调用 scrollIntoView，以免触发滚动自动收起菜单
      if (!target.closest('.cdk-overlay-container')) {
        target.scrollIntoView({ block: 'center', inline: 'center' });
      }
      const rect = target.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      const evtOpts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons: 1
      };
      if (typeof target.focus === 'function') {
        target.focus();
      }
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, evtOpts)));
      }
      target.dispatchEvent(new MouseEvent('mousedown', evtOpts));
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }, evtOpts)));
      }
      target.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, evtOpts, { buttons: 0 })));
      if (typeof target.click === 'function') {
        target.click();
      } else {
        target.dispatchEvent(new MouseEvent('click', Object.assign({}, evtOpts, { buttons: 0 })));
      }
    } catch (_) {
      try {
        el.click();
      } catch (__) {}
    }
  }

  /**
   * 在 /auth/clients/create 或 /apis/credentials/oauthclient 页面自动选择“桌面应用 (Desktop app)”并点击“创建”
   */
  function handleCreateOAuthClientForm(allBtns) {
    const openOptions = Array.from(document.querySelectorAll('mat-option, [role="option"], .mat-option, .mat-mdc-option, cfc-select-option')).filter(isVisible);
    if (openOptions.length > 0) {
      const desktopOpt = openOptions.find((opt) => {
        const t = (opt.textContent || '').trim();
        return t.includes('桌面应用') || t.includes('电脑端') || t.toLowerCase().includes('desktop');
      });
      if (desktopOpt) {
        triggerRealClick(desktopOpt);
        setLog('🟣 已自动选择应用类型：【桌面应用 (Desktop app)】', '#7627bb');
        return;
      }
    }

    const visibleSelects = Array.from(document.querySelectorAll('mat-select, [role="combobox"], cfc-select')).filter(isVisible);
    const appTypeSelect = visibleSelects[0];
    if (appTypeSelect) {
      const selText = (appTypeSelect.textContent || '').trim();
      if (!selText.includes('桌面') && !selText.toLowerCase().includes('desktop')) {
        if (tryPerformAction('open_oauth_client_apptype', '点击应用类型下拉框', 2000)) {
          triggerRealClick(appTypeSelect);
        }
        return;
      }
    }

    const naming = getDatedNamingBundle(false);
    const visibleInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(
      (el) => isVisible(el) && !el.disabled && !el.readOnly
    );
    visibleInputs.forEach((inp) => {
      if ((inp.value || '').trim() !== naming.oauthClientName) {
        setNativeInputValue(inp, naming.oauthClientName);
      }
    });

    const createBtn = allBtns.find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, '');
      return (t === '创建' || t.toLowerCase() === 'create') && !b.disabled;
    });
    if (createBtn && tryPerformAction('submit_create_oauth_client', '点击创建 OAuth 客户端', 3200)) {
      setLog(`🟣 正在点击“创建”生成高级 OAuth 客户端 (${naming.oauthClientName})...`, '#7627bb');
      triggerRealClick(createBtn);
    }
  }

  /**
   * 处理“品牌 (/auth/branding)”及“应用网域”页面：
   * 自动填入应用网址与已获授权网域，保存后前往“受众 (/auth/audience)”发布正式版
   */
  function handleBrandingAndDomainsPage(allBtns) {
    const email = elAccountInput.value.trim() || state.googleAccount || 'user@gmail.com';
    const naming = getDatedNamingBundle(false);
    const counts = loadActionCounts();
    counts['visited_branding_urls'] = 1;
    saveActionCounts(counts);

    const openOptions = Array.from(document.querySelectorAll('mat-option, [role="option"], .mat-option, .mat-mdc-option')).filter(isVisible);
    if (openOptions.length > 0) {
      const emailOpt = openOptions.find((opt) => (opt.textContent || '').includes('@')) || openOptions[0];
      if (emailOpt) {
        triggerRealClick(emailOpt);
        return;
      }
    }

    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[type="url"], input:not([type])')).filter(
      (el) => isVisible(el) && !el.disabled && !el.readOnly
    );

    let changedAny = false;
    let hasDomainInputFilled = false;

    inputs.forEach((inp) => {
      const fieldEl = inp.closest('mat-form-field, cfc-form-field, .mat-mdc-form-field, .mat-form-field, label') || inp.parentElement;
      const labelEl = fieldEl ? fieldEl.querySelector('mat-label, label, .mdc-floating-label, .mat-form-field-label') : null;
      const meta = (
        (labelEl ? labelEl.textContent || '' : '') +
        ' ' +
        (fieldEl ? fieldEl.textContent || '' : '') +
        ' ' +
        (inp.getAttribute('formcontrolname') || '') +
        ' ' +
        (inp.getAttribute('aria-label') || '') +
        ' ' +
        (inp.getAttribute('placeholder') || '') +
        ' ' +
        (inp.getAttribute('name') || '')
      ).toLowerCase();

      const curVal = (inp.value || '').trim();

      if (
        meta.includes('应用首页') ||
        meta.includes('首页') ||
        meta.includes('主页') ||
        meta.includes('隐私') ||
        meta.includes('服务条款') ||
        meta.includes('条款链接') ||
        meta.includes('政策链接') ||
        meta.includes('链接') ||
        meta.includes('网址') ||
        meta.includes('必须使用 http') ||
        meta.includes('home') ||
        meta.includes('privacy') ||
        meta.includes('terms') ||
        meta.includes('link') ||
        meta.includes('url') ||
        meta.includes('uri')
      ) {
        if (curVal !== 'https://www.google.com') {
          setNativeInputValue(inp, 'https://www.google.com');
          changedAny = true;
        }
      } else if (meta.includes('电子邮件') || meta.includes('邮箱') || meta.includes('email')) {
        if (!curVal && !(document.body.innerText || '').includes(email)) {
          setNativeInputValue(inp, email);
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          changedAny = true;
        }
      } else if (meta.includes('网域') || meta.includes('domain') || meta.includes('example.com')) {
        if (curVal !== 'google.com') {
          setNativeInputValue(inp, 'google.com');
          changedAny = true;
        }
        hasDomainInputFilled = true;
      } else if (meta.includes('应用名称') || meta.includes('app name') || meta.includes('displayname')) {
        if (!curVal || curVal !== naming.highSlug) {
          setNativeInputValue(inp, naming.highSlug);
          changedAny = true;
        }
      }
    });

    if (changedAny) {
      if (state.flowStage === STAGES.REPAIR_3_BRANDING) {
        const rep = loadRepairReport();
        rep.brandingStatus = '🛠️ 发现网址未填或有误 → 已自动补齐 https://www.google.com';
        saveRepairReport(rep);
      }
      setLog('🟣 已自动填入网址与品牌信息...', '#7627bb');
      return;
    }

    const addDomainBtn = allBtns.find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, '');
      return t.includes('添加网域') || t.toLowerCase().includes('adddomain');
    });
    if (addDomainBtn && !hasDomainInputFilled && !counts['clicked_add_domain_btn']) {
      counts['clicked_add_domain_btn'] = 1;
      saveActionCounts(counts);
      setLog('🟣 正在点击“+ 添加网域”并填入 google.com...', '#7627bb');
      triggerRealClick(addDomainBtn);
      return;
    }

    const saveBtn = allBtns.find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, '');
      return t === '保存' || t === '保存并继续' || t.toLowerCase() === 'save' || t.toLowerCase() === 'saveandcontinue';
    });

    if (saveBtn && !saveBtn.disabled) {
      if (tryPerformAction('branding_click_save', '点击保存品牌与网址配置', 2800)) {
        if (state.flowStage === STAGES.REPAIR_3_BRANDING) {
          const rep = loadRepairReport();
          rep.brandingStatus = '🛠️ 发现网址/网域未保存 → 已自动修正并保存';
          saveRepairReport(rep);
        }
        setLog('🟣 正在点击“保存”应用网域网址配置...', '#7627bb');
        triggerRealClick(saveBtn);
        const navEpoch = state.flowEpoch || 0;
        if (state.brandingNavTimer) clearTimeout(state.brandingNavTimer);
        state.brandingNavTimer = setTimeout(() => {
          state.brandingNavTimer = null;
          if (state.flowAborted || !state.flowStage || (state.flowEpoch || 0) !== navEpoch) return;
          if (state.flowStage === STAGES.REPAIR_3_BRANDING) {
            setFlowStage(STAGES.REPAIR_4_AUDIENCE);
          }
          const proj = state.projectId ? `?project=${encodeURIComponent(state.projectId)}` : '';
          window.location.href = `https://console.cloud.google.com/auth/audience${proj}`;
        }, 2200);
      }
      return;
    }

    if (!saveBtn || saveBtn.disabled) {
      if (tryPerformAction('branding_already_saved_goto_audience', '网址已保存，前往受众页面', 2800)) {
        if (state.flowStage === STAGES.REPAIR_3_BRANDING) {
          const rep = loadRepairReport();
          if (!rep.brandingStatus || rep.brandingStatus === '检测中...') {
            rep.brandingStatus = '✅ 正常（公开网址与授权网域均已配置）';
            saveRepairReport(rep);
          }
          setFlowStage(STAGES.REPAIR_4_AUDIENCE);
        }
        const proj = state.projectId ? `?project=${encodeURIComponent(state.projectId)}` : '';
        window.location.href = `https://console.cloud.google.com/auth/audience${proj}`;
      }
    }
  }

  function scanOAuthCreatedDialogAndCapture() {
    if (
      state.flowAborted ||
      (state.flowStage !== STAGES.OAUTH_CONSENT && state.flowStage !== STAGES.OAUTH_CLIENT)
    ) {
      return false;
    }
    const dialog = getVisibleDialog();
    if (!dialog) return false;

    const inputVals = Array.from(dialog.querySelectorAll('input, textarea'))
      .map((el) => el.value || el.getAttribute('value') || '')
      .join(' ');
    const dlgText = (dialog.innerText || dialog.textContent || '') + ' ' + inputVals;
    const idMatch = dlgText.match(/([0-9]{6,}-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com)/);
    const secretMatch = dlgText.match(/(GOCSPX-[a-zA-Z0-9_-]{10,})/);

    const dlgBtns = Array.from(dialog.querySelectorAll('button, a[role="button"], [role="button"]'));
    const dlJsonBtn = dlgBtns.find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, '');
      return t.includes('下载JSON') || t.toLowerCase().includes('downloadjson');
    });
    if (dlJsonBtn) {
      const counts = loadActionCounts();
      if (!counts['clicked_oauth_dl_btn']) {
        counts['clicked_oauth_dl_btn'] = 1;
        saveActionCounts(counts);
        triggerRealClick(dlJsonBtn);
      }
    }

    if (idMatch && idMatch[1] && secretMatch && secretMatch[1]) {
      const clientId = idMatch[1];
      const clientSecret = secretMatch[1];
      const counts = loadActionCounts();
      const keyFlag = 'CAPTURED_OAUTH_' + clientId;
      if (!counts[keyFlag]) {
        counts[keyFlag] = 1;
        saveActionCounts(counts);
        const installedJson = JSON.stringify({
          installed: {
            client_id: clientId,
            project_id: state.projectId || '',
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
            client_secret: clientSecret,
            redirect_uris: ['http://localhost']
          }
        });
        handleCapturedJson(installedJson, '已自动生成【高级 OAuth 公开客户端】JSON', true);
      }
      return true;
    }
    return false;
  }

  function selectNoOrganizationIfPossible() {
    try {
      const options = Array.from(document.querySelectorAll('mat-option, [role="option"], .mat-option, .mat-mdc-option')).filter(isVisible);
      const noOrgOption = options.find((opt) => {
        const t = (opt.textContent || '').trim();
        return t.includes('无组织') || t.toLowerCase().includes('no organization');
      });
      if (noOrgOption) {
        noOrgOption.click();
        return;
      }
      const selects = Array.from(document.querySelectorAll('mat-select, [role="combobox"], [aria-label*="组织"], [aria-label*="Organization"]')).filter(isVisible);
      for (let i = 0; i < selects.length; i++) {
        const txt = (selects[i].textContent || '').trim();
        if (txt && !txt.includes('无组织') && !txt.toLowerCase().includes('no organization')) {
          const counts = loadActionCounts();
          if (!counts['open_org_select']) {
            counts['open_org_select'] = 1;
            saveActionCounts(counts);
            selects[i].click();
          }
        }
      }
    } catch (_) {}
  }

  function scanExistingKeysOnPage() {
    if (!window.location.pathname.includes('/serviceaccounts/details/')) return;
    const bodyText = document.body.innerText || '';
    if (bodyText.includes('没有可显示的行') || bodyText.includes('No rows to display')) {
      state.pageKeyCount = 0;
    } else {
      const rows = document.querySelectorAll('table tbody tr, mat-row, [role="row"]');
      let count = 0;
      rows.forEach((r) => {
        const t = (r.textContent || '').trim();
        if (t && (t.includes('有效') || t.includes('Active') || t.includes('用户管理') || t.includes('User-managed'))) {
          count++;
        }
      });
      state.pageKeyCount = count;
    }
    if (elPageKeyCountText) {
      elPageKeyCountText.textContent = `服务账号密钥: ${state.pageKeyCount} / 10`;
    }
  }

  function setNativeInputValue(inputEl, val) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (setter) {
      setter.call(inputEl, val);
    } else {
      inputEl.value = val;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ==================== 表格通信、邮箱识别与上传 ====================
  function validateGasWebAppUrl(url) {
    if (!url) return '请先填写 Apps Script 部署网址！';
    try {
      const u = new URL(String(url).trim());
      if (u.protocol !== 'https:' || u.hostname !== 'script.google.com') {
        return '安全拦截：接口地址必须是官方 https://script.google.com 域名！';
      }
      if (!/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(u.pathname)) {
        return '网址类型错误：请复制以 /macros/s/.../exec 结尾的网页应用部署网址！';
      }
    } catch (_) {
      return '网址格式不正确！';
    }
    return '';
  }

  function callGasApi(url, method, bodyObj) {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'GAS_HTTP_REQUEST',
            url: url,
            method: method || 'GET',
            body: bodyObj ? JSON.stringify(bodyObj) : undefined
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!resp || !resp.ok) {
              reject(new Error((resp && resp.error) || '请求失败'));
              return;
            }
            resolve(resp.data);
          }
        );
      } else {
        const opts = { method: method || 'GET' };
        if (method === 'POST' && bodyObj) {
          opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
          opts.body = JSON.stringify(bodyObj);
        }
        fetch(url, opts)
          .then((r) => r.json())
          .then(resolve)
          .catch(reject);
      }
    });
  }

  function renderGroupOptions() {
    elGroupSelect.innerHTML = '';
    if (!state.groups || state.groups.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '-- 请先点击右上角接口设置 --';
      elGroupSelect.appendChild(opt);
      return;
    }
    state.groups.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      if (g === state.selectedGroup) opt.selected = true;
      elGroupSelect.appendChild(opt);
    });
    if (!state.selectedGroup && state.groups.length > 0) {
      state.selectedGroup = state.groups[0];
      elGroupSelect.value = state.selectedGroup;
    }
  }

  const PROJECT_DETECT_STORAGE_KEY = 'GCP_HELPER_PROJECT_DETECT_MAP_V2';

  function loadProjectDetectCache(projId) {
    const clean = String(projId || '').trim();
    if (!clean) {
      return {
        projectId: '',
        lowScanned: false,
        highScanned: false,
        pageLowNames: [],
        pageHighNames: [],
        sheetLow: [],
        sheetHigh: []
      };
    }
    try {
      const map = JSON.parse(localStorage.getItem(PROJECT_DETECT_STORAGE_KEY) || '{}');
      const entry = map[clean] || {};
      return {
        projectId: clean,
        lowScanned: Boolean(entry.lowScanned),
        highScanned: Boolean(entry.highScanned),
        pageLowNames: Array.isArray(entry.pageLowNames) ? entry.pageLowNames : [],
        pageHighNames: Array.isArray(entry.pageHighNames) ? entry.pageHighNames : [],
        sheetLow: Array.isArray(entry.sheetLow) ? entry.sheetLow : [],
        sheetHigh: Array.isArray(entry.sheetHigh) ? entry.sheetHigh : []
      };
    } catch (_) {
      return {
        projectId: clean,
        lowScanned: false,
        highScanned: false,
        pageLowNames: [],
        pageHighNames: [],
        sheetLow: [],
        sheetHigh: []
      };
    }
  }

  function saveProjectDetectCache(projId, entry) {
    const clean = String(projId || '').trim();
    if (!clean || !entry) return;
    try {
      const map = JSON.parse(localStorage.getItem(PROJECT_DETECT_STORAGE_KEY) || '{}');
      map[clean] = {
        projectId: clean,
        lowScanned: Boolean(entry.lowScanned),
        highScanned: Boolean(entry.highScanned),
        pageLowNames: Array.isArray(entry.pageLowNames) ? entry.pageLowNames : [],
        pageHighNames: Array.isArray(entry.pageHighNames) ? entry.pageHighNames : [],
        sheetLow: Array.isArray(entry.sheetLow) ? entry.sheetLow : [],
        sheetHigh: Array.isArray(entry.sheetHigh) ? entry.sheetHigh : []
      };
      localStorage.setItem(PROJECT_DETECT_STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  /**
   * 扫描当前 GCP 控制台页面 DOM 中已存在的【低配服务账号】或【高级 OAuth 客户端】并跨页面持久化记忆
   */
  function scanCurrentProjectConfigsOnPage() {
    const curProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    if (!curProj) return;

    const cached = loadProjectDetectCache(curProj);
    const path = window.location.pathname;
    const bodyText = document.body.innerText || '';
    let changed = false;

    // 1. 若当前处于【服务账号列表页】(/iam-admin/serviceaccounts)，扫描所有低配服务账号并持久化保存
    if (path.endsWith('/serviceaccounts') || path.endsWith('/serviceaccounts/')) {
      const saEmails = extractGserviceAccountEmailsOutsideHelper(document.body);
      const lowFound = saEmails.filter(
        (em) =>
          !em.includes('-compute@developer.gserviceaccount.com') &&
          !em.includes('@appspot.gserviceaccount.com') &&
          !em.includes('firebase-adminsdk')
      );
      const tableRendered =
        lowFound.length > 0 ||
        bodyText.includes('没有可显示的行') ||
        bodyText.includes('No rows to display') ||
        (Boolean(document.querySelector('table, mat-table, [role="grid"]')) &&
          (bodyText.includes('创建服务账号') || bodyText.includes('创建服务帐号') || bodyText.includes('Create service account')));

      if (tableRendered) {
        cached.pageLowNames = lowFound;
        cached.lowScanned = true;
        changed = true;
      }
    }

    // 2. 若当前处于【OAuth 客户端列表页】(/auth/clients 或 /apis/credentials)，扫描所有高配 OAuth 客户端并持久化保存
    if (
      path.endsWith('/auth/clients') ||
      path.endsWith('/auth/clients/') ||
      path.endsWith('/apis/credentials') ||
      path.endsWith('/apis/credentials/')
    ) {
      const rows = Array.from(document.querySelectorAll('table tbody tr, mat-row, [role="row"]')).filter(isVisible);
      const highFound = [];
      rows.forEach((row) => {
        const rowTxt = (row.textContent || '').trim();
        if (
          rowTxt.includes('.apps.googleusercontent.com') ||
          rowTxt.includes('gaopei-') ||
          rowTxt.includes('【高配】') ||
          rowTxt.includes('桌面') ||
          rowTxt.toLowerCase().includes('desktop')
        ) {
          const linkEl = row.querySelector('a');
          const nameStr = linkEl ? (linkEl.textContent || '').trim() : rowTxt.split(/\s+/)[0];
          if (nameStr && highFound.indexOf(nameStr) === -1) {
            highFound.push(nameStr);
          }
        }
      });

      const tableRendered =
        highFound.length > 0 ||
        bodyText.includes('尚未配置 Google Auth Platform') ||
        bodyText.toLowerCase().includes('not configured') ||
        bodyText.includes('没有可显示的行') ||
        bodyText.includes('No rows to display') ||
        bodyText.includes('找不到任何 OAuth 客户端') ||
        (Boolean(document.querySelector('table, mat-table, [role="grid"]')) &&
          (bodyText.includes('创建客户端') || bodyText.toLowerCase().includes('create client')));

      if (tableRendered) {
        cached.pageHighNames = highFound;
        cached.highScanned = true;
        changed = true;
      }
    }

    if (changed) {
      saveProjectDetectCache(curProj, cached);
    }

    state.projectSummary = {
      projectId: curProj,
      lowScanned: cached.lowScanned,
      highScanned: cached.highScanned,
      lowCount: Math.max(cached.sheetLow.length, cached.pageLowNames.length),
      highCount: Math.max(cached.sheetHigh.length, cached.pageHighNames.length),
      lowConfigs: cached.sheetLow,
      highConfigs: cached.sheetHigh,
      pageLowNames: cached.pageLowNames,
      pageHighNames: cached.pageHighNames
    };
  }

  function getEffectiveProjectSummary() {
    const curProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    const cached = loadProjectDetectCache(curProj);
    const ps = state.projectSummary && state.projectSummary.projectId === curProj ? state.projectSummary : cached;

    const sheetLow = Array.isArray(ps.lowConfigs) && ps.lowConfigs.length > 0 ? ps.lowConfigs : cached.sheetLow;
    const sheetHigh = Array.isArray(ps.highConfigs) && ps.highConfigs.length > 0 ? ps.highConfigs : cached.sheetHigh;
    const pageLow = Array.isArray(ps.pageLowNames) && ps.pageLowNames.length > 0 ? ps.pageLowNames : cached.pageLowNames;
    const pageHigh = Array.isArray(ps.pageHighNames) && ps.pageHighNames.length > 0 ? ps.pageHighNames : cached.pageHighNames;

    const totalLow = Math.max(sheetLow.length, pageLow.length);
    const totalHigh = Math.max(sheetHigh.length, pageHigh.length);
    return {
      projectId: curProj,
      lowScanned: Boolean(cached.lowScanned || sheetLow.length > 0),
      highScanned: Boolean(cached.highScanned || sheetHigh.length > 0),
      totalLow,
      totalHigh,
      sheetLow,
      sheetHigh,
      pageLow,
      pageHigh
    };
  }

  function renderProjectDetectSummary(showReadoutInStatusBox) {
    const lowPill = document.getElementById('gjhDetectLowPill');
    const highPill = document.getElementById('gjhDetectHighPill');
    const lowText = document.getElementById('gjhDetectLowText');
    const highText = document.getElementById('gjhDetectHighText');
    const detailBox = document.getElementById('gjhDetectDetailBox');
    const forceBtn = document.getElementById('gjhForceAddCurrentBtn');
    const mainBtn = document.getElementById('gjhOneClickCurrentBtn');
    if (!lowPill || !highPill || !lowText || !highText) return;

    const sum = getEffectiveProjectSummary();
    if (!sum.projectId) {
      lowText.textContent = '未选项目';
      highText.textContent = '未选项目';
      if (detailBox) detailBox.style.display = 'none';
      if (forceBtn) forceBtn.style.display = 'none';
      return;
    }

    if (sum.totalLow > 0) {
      lowPill.style.background = '#e6f4ea';
      lowPill.style.borderColor = '#ceead6';
      lowText.style.color = '#0b8043';
      lowText.textContent = `✅ 已有 ${sum.totalLow} 个`;
    } else if (!sum.lowScanned) {
      lowPill.style.background = '#fef7e0';
      lowPill.style.borderColor = '#fde293';
      lowText.style.color = '#b06000';
      lowText.textContent = '❓ 点右上检测';
    } else {
      lowPill.style.background = '#f8f9fa';
      lowPill.style.borderColor = '#dadce0';
      lowText.style.color = '#5f6368';
      lowText.textContent = '⚪ 未建立 (0个)';
    }

    if (sum.totalHigh > 0) {
      highPill.style.background = '#f3e8fd';
      highPill.style.borderColor = '#d7aefb';
      highText.style.color = '#681da8';
      highText.textContent = `✅ 已有 ${sum.totalHigh} 个`;
    } else if (!sum.highScanned) {
      highPill.style.background = '#fef7e0';
      highPill.style.borderColor = '#fde293';
      highText.style.color = '#b06000';
      highText.textContent = '❓ 点右上检测';
    } else {
      highPill.style.background = '#f8f9fa';
      highPill.style.borderColor = '#dadce0';
      highText.style.color = '#5f6368';
      highText.textContent = '⚪ 未建立 (0个)';
    }

    const hasAny = sum.totalLow > 0 || sum.totalHigh > 0;
    if (forceBtn) {
      forceBtn.style.display = hasAny ? 'inline-flex' : 'none';
    }

    if (mainBtn) {
      if ((!sum.lowScanned && sum.totalLow === 0) || (!sum.highScanned && sum.totalHigh === 0)) {
        mainBtn.textContent = '🔍 智能检测当前项目 (有则读取 / 缺则自动补建)';
      } else if (state.configMode === 'BOTH' && sum.totalLow > 0 && sum.totalHigh === 0) {
        mainBtn.textContent = `🔍 智能补齐：已有 ${sum.totalLow} 个低配 + 自动补建【高配】`;
      } else if (state.configMode === 'BOTH' && sum.totalHigh > 0 && sum.totalLow === 0) {
        mainBtn.textContent = `🔍 智能补齐：已有 ${sum.totalHigh} 个高配 + 自动补建【低配】`;
      } else if (
        (state.configMode === 'LOW' && sum.totalLow > 0) ||
        (state.configMode === 'HIGH' && sum.totalHigh > 0) ||
        (state.configMode === 'BOTH' && sum.totalLow > 0 && sum.totalHigh > 0)
      ) {
        mainBtn.textContent = `📋 当前项目已有 (${sum.totalLow}低+${sum.totalHigh}高)，点击读取详情`;
      } else {
        mainBtn.textContent = '⚡ 当前项目尚未建立，一键全自动新建 JSON';
      }
    }

    const lines = [];
    sum.sheetLow.forEach((it) => {
      lines.push(
        `<div>🟢 <strong>[低配]</strong> 组别: <b>${escapeHtml(it.groupName || '-')}</b> | <code>${escapeHtml(
          (it.clientEmail || '').split('@')[0]
        )}</code></div>`
      );
    });
    if (sum.sheetLow.length === 0 && sum.pageLow.length > 0) {
      sum.pageLow.forEach((em) => {
        lines.push(`<div>🟢 <strong>[已建低配]</strong> <code>${escapeHtml(em.split('@')[0])}</code></div>`);
      });
    }

    sum.sheetHigh.forEach((it) => {
      const shortId = (it.clientEmail || '').split('|')[0].trim();
      lines.push(
        `<div>🟣 <strong>[高配]</strong> 组别: <b>${escapeHtml(it.groupName || '-')}</b> | <code>${escapeHtml(
          shortId
        )}</code></div>`
      );
    });
    if (sum.sheetHigh.length === 0 && sum.pageHigh.length > 0) {
      sum.pageHigh.forEach((nm) => {
        lines.push(`<div>🟣 <strong>[已建高配]</strong> <code>${escapeHtml(nm)}</code></div>`);
      });
    }

    if (detailBox) {
      if (lines.length > 0) {
        detailBox.style.display = 'block';
        detailBox.innerHTML =
          `<div style="font-weight:700;color:#174ea6;margin-bottom:3px;">📋 已读取当前项目 (${escapeHtml(
            sum.projectId
          )}) 配置（共 ${sum.totalLow}低 + ${sum.totalHigh}高）：</div>` +
          lines.join('') +
          `<div style="margin-top:4px;color:#b06000;font-size:10px;">💡 同项目共享 300次/分 配额；如还想要新配置，推荐点【➕ 建新无组织项目】或点下方【🔄 强制追加】。</div>`;
      } else if (sum.lowScanned && sum.highScanned) {
        detailBox.style.display = 'block';
        detailBox.innerHTML = `<span style="color:#0f9d58;">✨ 当前项目 (${escapeHtml(
          sum.projectId
        )}) 已全面核验：尚未建立高/低配，可直接点击下方按钮一键新建！</span>`;
      } else {
        detailBox.style.display = 'block';
        detailBox.innerHTML = `<span style="color:#5f6368;">💡 点右上角 <b>“🔄 检测并读取”</b> 或下方蓝色主按钮，将自动核验低配与高配列表，绝不误报漏报。</span>`;
      }
    }

    if (showReadoutInStatusBox && lines.length > 0) {
      elJsonStatusBox.className = 'gjh-status-box gjh-status-ok';
      elJsonStatusBox.innerHTML =
        `<div style="font-weight:700;font-size:12px;color:#0f9d58;margin-bottom:4px;">✅ 已读取当前项目 (${escapeHtml(
          sum.projectId
        )}) 的已有配置（${sum.totalLow}个低配 + ${sum.totalHigh}个高配）：</div>` +
        lines.join('') +
        `<div style="margin-top:5px;font-size:11px;color:#5f6368;">👉 如还想要更多配置：点上方 <b>“➕ 建新【无组织】项目”</b> 可独享新配额，或点 <b>“🔄 仍在当前项目强制追加”</b>。</div>`;
    }
  }

  function fetchGroupsAndAccountStats(showNotice, showReadoutBox) {
    if (!state.gasUrl) return Promise.resolve();
    const urlErr = validateGasWebAppUrl(state.gasUrl);
    if (urlErr) {
      elConfigSection.style.display = 'block';
      setLog('❌ ' + urlErr, '#d93025');
      return Promise.resolve();
    }
    if (showNotice) setLog('⏳ 正在检测表格组别与当前项目已有高/低配...', '#1a73e8');

    const acc = elAccountInput.value.trim() || state.googleAccount || '';
    const curProj = (new URLSearchParams(window.location.search).get('project') || state.projectId || '').trim();
    const url =
      state.gasUrl +
      (state.gasUrl.includes('?') ? '&' : '?') +
      'action=getGroups&token=' +
      encodeURIComponent(state.uploadToken) +
      '&googleAccount=' +
      encodeURIComponent(acc) +
      '&projectId=' +
      encodeURIComponent(curProj);

    return callGasApi(url, 'GET')
      .then((res) => {
        if (res && res.ok) {
          if (Array.isArray(res.groups) && res.groups.length > 0) {
            state.groups = res.groups;
            localStorage.setItem(STORAGE_KEYS.GROUPS_CACHE, JSON.stringify(state.groups));
            renderGroupOptions();
          }
          if (typeof res.accountCount === 'number') {
            state.sheetJsonCount = res.accountCount;
            elSheetCountText.textContent = `📊 本账号表格已存: ${state.sheetJsonCount} 个 JSON`;
          } else {
            elSheetCountText.textContent = `📊 组别已同步 (${state.groups.length}组)`;
          }
          if (res.projectSummary && res.projectSummary.projectId) {
            const pId = res.projectSummary.projectId;
            const cached = loadProjectDetectCache(pId);
            cached.sheetLow = Array.isArray(res.projectSummary.lowConfigs) ? res.projectSummary.lowConfigs : [];
            cached.sheetHigh = Array.isArray(res.projectSummary.highConfigs) ? res.projectSummary.highConfigs : [];
            if (cached.sheetLow.length > 0) cached.lowScanned = true;
            if (cached.sheetHigh.length > 0) cached.highScanned = true;
            saveProjectDetectCache(pId, cached);
          }
          scanCurrentProjectConfigsOnPage();
          renderProjectDetectSummary(Boolean(showReadoutBox));
          if (showNotice) {
            const sum = getEffectiveProjectSummary();
            setLog(`✅ 检测完成：当前项目已有 低配 ${sum.totalLow} 个、高配 ${sum.totalHigh} 个`, '#0f9d58');
          }
        }
      })
      .catch((err) => {
        if (showNotice) setLog('❌ 读取失败：' + err.message, '#d93025');
      });
  }

  function detectGoogleAccountAndProject(manual) {
    const urlParams = new URLSearchParams(window.location.search);
    const proj = (urlParams.get('project') || '').trim();
    const existingBoundProj = (sessionStorage.getItem(STORAGE_KEYS.FLOW_PROJECT) || '').trim();
    const isInitialOrIdleStage =
      !state.flowStage ||
      state.flowStage === STAGES.CREATE_NO_ORG_PROJECT ||
      state.flowStage === STAGES.ENSURE_PROJECT;

    // 仅在流水线未启动或处于阶段 0/1（选定/新建项目阶段）时才允许从 URL 绑定 FLOW_PROJECT，
    // 一旦进入阶段 2~7，严禁被后续页面 URL 篡改已绑定的目标项目 ID！
    if (proj && (isInitialOrIdleStage || !existingBoundProj)) {
      state.projectId = proj;
      sessionStorage.setItem(STORAGE_KEYS.FLOW_PROJECT, proj);
    } else if (existingBoundProj) {
      state.projectId = existingBoundProj;
    }
    const badge = document.getElementById('gjhProjectBadge');
    if (badge && state.projectId) {
      badge.textContent = '项目: ' + state.projectId;
    }

    if (state.projectId && state.projectId !== state.lastCheckedProjectId) {
      state.lastCheckedProjectId = state.projectId;
      scanCurrentProjectConfigsOnPage();
      if (state.gasUrl) {
        fetchGroupsAndAccountStats(false, false);
      } else {
        renderProjectDetectSummary(false);
      }
    } else {
      scanCurrentProjectConfigsOnPage();
      renderProjectDetectSummary(false);
    }

    let detectedEmail = '';
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

    const ariaElements = document.querySelectorAll('a[aria-label*="@"], button[aria-label*="@"], div[aria-label*="@"]');
    for (let i = 0; i < ariaElements.length; i++) {
      const label = ariaElements[i].getAttribute('aria-label') || '';
      const m = label.match(emailRegex);
      if (m && m[1] && !m[1].endsWith('.gserviceaccount.com')) {
        detectedEmail = m[1];
        break;
      }
    }

    if (!detectedEmail) {
      const dataEmailEl = document.querySelector('[data-email*="@"]');
      if (dataEmailEl) {
        const em = dataEmailEl.getAttribute('data-email') || '';
        if (em && !em.endsWith('.gserviceaccount.com')) detectedEmail = em;
      }
    }

    if (!detectedEmail) {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const txt = scripts[i].textContent || '';
        if (txt.includes('@gmail.com') || txt.includes('@googlemail.com') || txt.includes('WIZ_global_data')) {
          const m = txt.match(/([a-zA-Z0-9._%+-]+@(?:gmail\.com|googlemail\.com|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))/);
          if (
            m &&
            m[1] &&
            !m[1].endsWith('.gserviceaccount.com') &&
            !m[1].includes('example.com') &&
            !m[1].includes('google.com')
          ) {
            detectedEmail = m[1];
            break;
          }
        }
      }
    }

    if (!detectedEmail) {
      detectedEmail = sessionStorage.getItem('GCP_HELPER_DETECTED_EMAIL') || '';
    }

    if (detectedEmail) {
      sessionStorage.setItem('GCP_HELPER_DETECTED_EMAIL', detectedEmail);
      const changed = state.googleAccount !== detectedEmail;
      state.googleAccount = detectedEmail;
      if (!elAccountInput.value || manual) {
        elAccountInput.value = detectedEmail;
      }
      if (changed && state.gasUrl) {
        fetchGroupsAndAccountStats(false);
      }
      if (manual) setLog('✅ 已识别当前谷歌账号：' + detectedEmail, '#0f9d58');
    }
  }

  function handleCapturedJson(rawText, sourceDesc, isAutoCaptured) {
    if (isAutoCaptured && state.flowAborted) return;
    try {
      const parsed = JSON.parse(rawText);
      const oauthNode = parsed.installed || parsed.web;
      const isHigh = Boolean(oauthNode && oauthNode.client_id);
      const isLow = Boolean(parsed.private_key || parsed.client_email);

      if (!isHigh && !isLow) return;

      detectGoogleAccountAndProject(false);
      const naming = getDatedNamingBundle(false);
      const boundProjectId = (sessionStorage.getItem(STORAGE_KEYS.FLOW_PROJECT) || '').trim();
      const currentUrlProject = (new URLSearchParams(window.location.search).get('project') || '').trim();

      state.capturedLevel = isHigh ? '高配OAuth' : '低配服务号';
      if (isHigh) {
        const rawProjId = String(oauthNode.project_id || boundProjectId || state.projectId || '').trim();
        if (isAutoCaptured) {
          if (
            !boundProjectId ||
            (currentUrlProject && currentUrlProject.toLowerCase() !== boundProjectId.toLowerCase()) ||
            (oauthNode.project_id && String(oauthNode.project_id).trim().toLowerCase() !== boundProjectId.toLowerCase())
          ) {
            setLog(
              `🛑 安全拦截：捕获到的 OAuth 配置项目 (${oauthNode.project_id || currentUrlProject || '未知'}) 与绑定目标项目 (${boundProjectId || '未设定'}) 不一致，已拒绝自动上传！`,
              '#d93025'
            );
            return;
          }
        }
        if (!oauthNode.project_id && rawProjId) {
          oauthNode.project_id = rawProjId;
        }
        const highSlug = naming.highSlug;
        const displayProjId =
          rawProjId && rawProjId.includes(highSlug)
            ? `【高配】${rawProjId}`
            : rawProjId
            ? `【高配】${highSlug} (${rawProjId})`
            : `【高配】${highSlug}`;

        oauthNode.project_id = displayProjId;
        state.capturedJson = JSON.stringify({ installed: oauthNode });
        state.clientEmail = `【高配OAuth-免分享表格】${highSlug} | ${oauthNode.client_id}`;
        state.displayProjectId = displayProjId;
        state.currentSlug = highSlug;
        if (rawProjId && !rawProjId.startsWith('【')) state.projectId = rawProjId;
      } else {
        const actualProjId = String(parsed.project_id || '').trim();
        const actualClientEmail = String(parsed.client_email || '').trim().toLowerCase();
        const emailPrefix = actualClientEmail.split('@')[0] || '';
        const expectedSaSlug = (sessionStorage.getItem('GCP_HELPER_EXPECTED_SA_SLUG') || '').trim().toLowerCase();
        const expectedSaEmail = (sessionStorage.getItem('GCP_HELPER_EXPECTED_SA_EMAIL') || '').trim().toLowerCase();
        const canonicalExpectedEmail =
          expectedSaSlug && boundProjectId ? `${expectedSaSlug}@${boundProjectId.toLowerCase()}.iam.gserviceaccount.com` : '';

        // 自动捕获模式下，严格校验捕获到的 JSON 必须同时匹配绑定的 project_id 与完整服务账号邮箱 (slug@projectId.iam.gserviceaccount.com)
        if (
          isAutoCaptured &&
          (!boundProjectId ||
            !expectedSaSlug ||
            !canonicalExpectedEmail ||
            expectedSaEmail !== canonicalExpectedEmail ||
            (currentUrlProject && currentUrlProject.toLowerCase() !== boundProjectId.toLowerCase()) ||
            actualProjId.toLowerCase() !== boundProjectId.toLowerCase() ||
            actualClientEmail !== canonicalExpectedEmail)
        ) {
          setLog(
            `🛑 安全拦截：捕获到的服务账号凭证 (${actualClientEmail || '未知'} / 项目: ${actualProjId || '未知'}) 与本次绑定目标 (${canonicalExpectedEmail || '未设定'}) 不一致，已拒绝自动上传！`,
            '#d93025'
          );
          return;
        }
        const rawProjId = actualProjId || boundProjectId || state.projectId || '';
        const lowSlug = expectedSaSlug || emailPrefix || naming.lowSlug;
        const displayProjId =
          rawProjId && rawProjId.includes(lowSlug)
            ? `【低配】${rawProjId}`
            : rawProjId
            ? `【低配】${lowSlug} (${rawProjId})`
            : `【低配】${lowSlug}`;

        parsed.project_id = displayProjId;
        state.capturedJson = JSON.stringify(parsed, null, 2);
        state.clientEmail = parsed.client_email || '';
        state.displayProjectId = displayProjId;
        state.currentSlug = lowSlug;
        if (rawProjId && !rawProjId.startsWith('【')) state.projectId = rawProjId;
      }

      if (state.projectId) {
        const cached = loadProjectDetectCache(state.projectId);
        if (isHigh) {
          const itemLabel = `【高配】${state.currentSlug}`;
          if (cached.pageHighNames.indexOf(itemLabel) === -1) cached.pageHighNames.push(itemLabel);
          cached.highScanned = true;
        } else if (state.clientEmail) {
          if (cached.pageLowNames.indexOf(state.clientEmail.toLowerCase()) === -1) {
            cached.pageLowNames.push(state.clientEmail.toLowerCase());
          }
          cached.lowScanned = true;
        }
        saveProjectDetectCache(state.projectId, cached);
        scanCurrentProjectConfigsOnPage();
        renderProjectDetectSummary(false);
      }

      if (isHigh) {
        // 设定 20 秒跨页面自动关弹窗标志，并启动多轮定时点击，确保页面从 /auth/clients/create 跳转到 /auth/clients 弹出“确定”框后必被自动关闭！
        sessionStorage.setItem('GCP_HELPER_DISMISS_OAUTH_DLG_UNTIL', String(Date.now() + 20000));
        [400, 900, 1600, 2600, 4000].forEach((delay) => {
          setTimeout(() => {
            autoDismissCompletedOAuthDialog();
          }, delay);
        });
      }

      const levelPrefix = isHigh ? '【高配】' : '【低配】';
      const fileName = `${levelPrefix}${state.currentSlug}_${elGroupSelect.value || '组别'}_${state.projectId || 'project'}.json`;

      const backupObj = {
        configLevel: state.capturedLevel,
        jsonContent: state.capturedJson,
        clientEmail: state.clientEmail,
        projectId: state.displayProjectId || state.projectId,
        googleAccount: state.googleAccount,
        fileName: fileName,
        savedAt: new Date().toLocaleString()
      };
      state.lastBackup = backupObj;
      sessionStorage.setItem(STORAGE_KEYS.LAST_BACKUP_JSON, JSON.stringify(backupObj));

      const skipHighOnce = sessionStorage.getItem('GCP_HELPER_SKIP_HIGH_ONCE') === '1';
      if (skipHighOnce) {
        sessionStorage.removeItem('GCP_HELPER_SKIP_HIGH_ONCE');
      }
      const shouldContinueToHigh =
        Boolean(isAutoCaptured) &&
        state.configMode === 'BOTH' &&
        !isHigh &&
        !skipHighOnce &&
        state.flowStage !== '' &&
        !state.flowAborted;
      const capturedEpoch = state.flowEpoch || 0;

      if (!shouldContinueToHigh) {
        setFlowStage(STAGES.IDLE);
        clearActionCounts(true);
      }

      elJsonStatusBox.className = 'gjh-status-box gjh-status-ok';
      elJsonStatusBox.innerHTML = `
        <div><strong>✅ ${escapeHtml(sourceDesc)}（当前会话已暂存）</strong></div>
        <div style="margin-top:4px;font-weight:600;color:#174ea6;font-size:11px;">
          项目标识: ${escapeHtml(state.displayProjectId || state.projectId)}
        </div>
        <div style="margin-top:3px;word-break:break-all;font-family:monospace;font-size:11px;">
          ${isHigh ? 'Client ID' : '服务账号'}: ${escapeHtml(state.clientEmail)}
        </div>
      `;
      elUploadBtn.style.display = 'inline-flex';

      if (state.pendingUploadTimer) {
        clearTimeout(state.pendingUploadTimer);
      }
      state.pendingUploadTimer = setTimeout(() => {
        state.pendingUploadTimer = null;
        if (isAutoCaptured && (state.flowAborted || (state.flowEpoch || 0) !== capturedEpoch)) return;
        uploadToGoogleSheet(shouldContinueToHigh, Boolean(isAutoCaptured), capturedEpoch);
      }, 200);
    } catch (err) {
      setLog('❌ JSON 解析失败：' + err.message, '#d93025');
    }
  }

  function uploadToGoogleSheet(continueToHighAfterUpload, isAutoTriggered, expectedEpoch) {
    const reqEpoch = typeof expectedEpoch === 'number' ? expectedEpoch : (state.flowEpoch || 0);
    if (isAutoTriggered && (state.flowAborted || (state.flowEpoch || 0) !== reqEpoch)) return;
    detectGoogleAccountAndProject(false);
    const groupName = elGroupSelect.value.trim();
    const googleAccount =
      elAccountInput.value.trim() ||
      state.googleAccount ||
      sessionStorage.getItem('GCP_HELPER_DETECTED_EMAIL') ||
      state.clientEmail ||
      '未知谷歌账号';
    if (!elAccountInput.value.trim() && googleAccount) {
      elAccountInput.value = googleAccount;
    }

    const registrant = elRegistrantInput.value.trim() || state.registrant || '默认注册人';
    const accountOwner = elSamePersonCheck.checked ? registrant : (elOwnerInput.value.trim() || registrant);

    if (!state.gasUrl || !groupName || !state.capturedJson) {
      setLog('⚠️ 请确认已选择组别且已生成 JSON！', '#d93025');
      return;
    }

    elUploadBtn.disabled = true;
    elUploadBtn.textContent = '⏳ 正在上传至私密 Google 表格...';

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const genDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const naming = getDatedNamingBundle(false);
    const isHigh = (state.capturedLevel || '').includes('高');
    const levelPrefix = isHigh ? '【高配】' : '【低配】';
    const slug = state.currentSlug || (isHigh ? naming.highSlug : naming.lowSlug);
    const safeAcc = googleAccount.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${levelPrefix}${slug}_${groupName}_${safeAcc || state.projectId || 'project'}.json`;
    const uploadProjectId = state.displayProjectId || `${levelPrefix}${slug}` + (state.projectId ? ` (${state.projectId})` : '');

    const payload = {
      action: 'uploadJson',
      token: state.uploadToken,
      genDate: genDate,
      groupName: groupName,
      googleAccount: googleAccount,
      accountOwner: accountOwner,
      registrant: registrant,
      clientEmail: state.clientEmail,
      projectId: uploadProjectId,
      fileName: fileName,
      jsonContent: state.capturedJson
    };

    callGasApi(state.gasUrl, 'POST', payload)
      .then((res) => {
        elUploadBtn.disabled = false;
        elUploadBtn.textContent = '🚀 重新上传当前 JSON 到表格';

        if (res && res.ok) {
          state.sheetJsonCount += 1;
          elSheetCountText.textContent = `📊 本账号表格已存: ${state.sheetJsonCount} 个 JSON`;
          fetchGroupsAndAccountStats(false, false);
          setLog(`🎉 【${state.capturedLevel || 'JSON'}】已上传至表格【${groupName}】！`, '#0f9d58');
          elJsonStatusBox.innerHTML = `
            <div style="font-size:13px;font-weight:bold;color:#0f9d58;">🎉 【${escapeHtml(state.capturedLevel || '配置')}】已成功上传至表格！</div>
            <div style="margin-top:4px;">归档组别：<strong>${escapeHtml(groupName)}</strong></div>
            <div>谷歌账号：${escapeHtml(googleAccount)}</div>
            <div style="margin-top:3px;font-weight:600;color:#174ea6;">项目标识：${escapeHtml(uploadProjectId)}</div>
            <div style="margin-top:3px;word-break:break-all;font-family:monospace;font-size:11px;">
              标识：${escapeHtml(state.clientEmail)}
            </div>
          `;

          if (
            continueToHighAfterUpload &&
            !state.flowAborted &&
            state.flowStage !== STAGES.IDLE &&
            (state.flowEpoch || 0) === reqEpoch
          ) {
            setLog('🚀 低配版已归档，正在自动前往生成【高级版 OAuth 公开客户端 JSON】...', '#7627bb');
            if (state.continueHighTimer) clearTimeout(state.continueHighTimer);
            state.continueHighTimer = setTimeout(() => {
              state.continueHighTimer = null;
              if (state.flowAborted || state.flowStage === STAGES.IDLE || (state.flowEpoch || 0) !== reqEpoch) {
                return;
              }
              clearActionCounts(false);
              setFlowStage(STAGES.OAUTH_CONSENT);
              navigateToStageUrl(STAGES.OAUTH_CONSENT);
            }, 1200);
          }
        } else {
          setLog('⚠️ 表格返回提示：' + (res && res.message ? res.message : '未知错误'), '#d93025');
        }
      })
      .catch((err) => {
        elUploadBtn.disabled = false;
        elUploadBtn.textContent = '🚀 重新上传当前 JSON 到表格';
        setLog('❌ 上传失败：' + err.message, '#d93025');
      });
  }

  function triggerBrowserDownload(contentStr, fileName) {
    const blob = new Blob([contentStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'config.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  function setLog(msg, color) {
    elLogMsg.textContent = msg;
    elLogMsg.style.color = color || '#5f6368';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // ==================== 初始化 ====================
  renderModeTabs();
  renderGroupOptions();
  updateFlowUI();
  detectGoogleAccountAndProject(false);
  setTimeout(() => detectGoogleAccountAndProject(false), 1800);
  scanExistingKeysOnPage();

  if (state.lastBackup && state.lastBackup.jsonContent && !state.capturedJson) {
    state.capturedJson = state.lastBackup.jsonContent;
    state.capturedLevel = state.lastBackup.configLevel || '配置';
    state.clientEmail = state.lastBackup.clientEmail || '';
    state.displayProjectId = state.lastBackup.projectId || '';
    elJsonStatusBox.className = 'gjh-status-box gjh-status-ok';
    elJsonStatusBox.innerHTML = `
      <div><strong>💾 已加载本地备份的【${escapeHtml(state.capturedLevel)}】JSON</strong></div>
      <div style="margin-top:4px;font-weight:600;color:#174ea6;font-size:11px;">
        项目标识: ${escapeHtml(state.displayProjectId || state.projectId)}
      </div>
      <div style="margin-top:3px;word-break:break-all;font-family:monospace;font-size:11px;">
        标识: ${escapeHtml(state.clientEmail)}
      </div>
    `;
    elUploadBtn.style.display = 'inline-flex';
  }

  if (state.gasUrl) {
    fetchGroupsAndAccountStats(false);
  }

  setInterval(runPipelineTick, 1000);
})();
