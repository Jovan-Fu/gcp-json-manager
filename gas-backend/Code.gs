/**
 * ============================================================================
 * 谷歌服务账号 JSON 密钥私密归档与按组下载系统 - Google Apps Script 后端 (Code.gs)
 * ============================================================================
 * 
 * 使用方法：
 * 1. 新建一个私密的 Google 表格（保持默认“限制/仅自己可访问”，无需公开）
 * 2. 点击顶部菜单：扩展程序 (Extensions) -> Apps Script
 * 3. 将本文件内容完整粘贴到 Code.gs 中
 * 4. 在左侧文件列表点击 "+" -> HTML，文件命名为 Index（系统会自动变成 Index.html），粘贴 Index.html 的内容
 * 5. 点击上方运行一次 initSpreadsheet 函数（首次会提示授权，点“高级 -> 继续”）
 * 6. 点击右上角“部署” -> “新建部署”：
 *    - 类型选择：网页应用 (Web App)
 *    - 执行身份：我 (Me)  <-- 关键！保证表格私密，由脚本代为安全读写
 *    - 谁可以访问：所有人 (Anyone) <-- 仅开放脚本接口，表格本身依然私密
 * 7. 复制部署后的“网页应用网址 (Web App URL)”，填入浏览器扩展脚本中使用即可。
 */

// ==================== 系统配置区 ====================
const CONFIG = {
  // 配置表名称（用于存放组别名称与对应密码）
  CONFIG_SHEET_NAME: '配置表',
  // 数据总表名称（存放所有上传记录，并自动按组别排序归类）
  MAIN_DATA_SHEET_NAME: 'JSON数据总表',
  // 是否同时为每个组自动创建/同步独立的子工作表（如 "组别_一组"），真正做到同组数据放在一起
  AUTO_CREATE_GROUP_SHEET: true,
  // 上传接口安全校验码（可自定义修改，需与浏览器脚本里的 UPLOAD_TOKEN 保持一致；留空则不校验）
  UPLOAD_TOKEN: 'GCP_JSON_UPLOAD_2026'
};

// 数据表表头定义
const DATA_HEADERS = [
  '生成日期',
  '所属组别',
  '谷歌账号',
  '账号人',
  '注册人',
  '服务账号邮箱 (client_email)',
  '项目ID (project_id)',
  'JSON文件名',
  'JSON文件内容',
  '密钥ID (private_key_id)',
  '下载次数'
];

/**
 * 表格打开时自动添加管理菜单
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔐 JSON密钥管理系统')
    .addItem('1. 初始化/修复表格结构', 'initSpreadsheet')
    .addItem('2. 按组别重新整理总表排序', 'sortMainSheetByGroup')
    .addItem('3. 一键为历史数据补齐【高配/低配】标识', 'backfillConfigLevelTags')
    .addItem('4. 一键把弱密码/空密码升级为随机独立密码', 'upgradeWeakGroupPasswords')
    .addToUi();
}

/**
 * 初始化表格结构（自动创建“配置表”与“JSON数据总表”）
 */
function initSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 初始化【配置表】
  let configSheet = ss.getSheetByName(CONFIG.CONFIG_SHEET_NAME);
  if (!configSheet) {
    configSheet = ss.insertSheet(CONFIG.CONFIG_SHEET_NAME, 0);
    configSheet.getRange(1, 1, 1, 3).setValues([['组别名称 (下拉菜单读取此列)', '访问密码 (必填：请单独设置强密码，禁止与组名相同)', '备注说明']]);
    configSheet.getRange(1, 1, 1, 3)
      .setBackground('#1a73e8')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    // 写入默认示例组别（均自动生成随机独立密码，禁止默认密码等于组名）
    configSheet.getRange(2, 1, 3, 3).setNumberFormat('@').setValues([
      ['一组', generateRandomPassword_(10), '请将B列独立密码发给一组组员'],
      ['二组', generateRandomPassword_(10), '请将B列独立密码发给二组组员'],
      ['三组', generateRandomPassword_(10), '请将B列独立密码发给三组组员']
    ]);
    configSheet.setFrozenRows(1);
    configSheet.setColumnWidth(1, 220);
    configSheet.setColumnWidth(2, 280);
    configSheet.setColumnWidth(3, 300);
  }

  // 2. 初始化【JSON数据总表】
  let mainSheet = ss.getSheetByName(CONFIG.MAIN_DATA_SHEET_NAME);
  if (!mainSheet) {
    mainSheet = ss.insertSheet(CONFIG.MAIN_DATA_SHEET_NAME, 1);
    formatDataSheetHeader_(mainSheet);
  } else {
    ensureDownloadCountHeader_(mainSheet);
  }

  return '表格结构初始化完成！';
}

/**
 * 自动为已存在的数据表补齐第 11 列“下载次数”表头（兼容旧表无缝升级）
 */
function ensureDownloadCountHeader_(sheet) {
  if (!sheet) return;
  const colIdx = 11; // K列：下载次数
  const curHeader = String(sheet.getRange(1, colIdx).getDisplayValue() || '').trim();
  if (curHeader !== '下载次数') {
    sheet.getRange(1, colIdx)
      .setValue('下载次数')
      .setBackground('#0f9d58')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.setColumnWidth(colIdx, 95);
  }
}

/**
 * 格式化数据表表头
 */
function formatDataSheetHeader_(sheet) {
  sheet.getRange(1, 1, 1, DATA_HEADERS.length).setValues([DATA_HEADERS]);
  sheet.getRange(1, 1, 1, DATA_HEADERS.length)
    .setBackground('#0f9d58')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 160); // 生成日期
  sheet.setColumnWidth(2, 110); // 所属组别
  sheet.setColumnWidth(3, 210); // 谷歌账号
  sheet.setColumnWidth(4, 100); // 账号人
  sheet.setColumnWidth(5, 100); // 注册人
  sheet.setColumnWidth(6, 280); // 服务账号邮箱
  sheet.setColumnWidth(7, 160); // 项目ID
  sheet.setColumnWidth(8, 220); // JSON文件名
  sheet.setColumnWidth(9, 320); // JSON文件内容
  sheet.setColumnWidth(10, 180); // 密钥ID
  sheet.setColumnWidth(11, 95);  // 下载次数
}

/**
 * 处理 GET 请求：
 * - 当带有 ?action=getGroups 时，返回【配置表】A列的组别列表供浏览器脚本下拉框使用
 * - 当直接用浏览器打开网址时，渲染按组查看与下载 JSON 的网页 (Index.html)
 */
function doGet(e) {
  initSpreadsheet();
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

  if (action === 'getGroups' || action === 'getAccountStats') {
    const token = (e.parameter && e.parameter.token) ? String(e.parameter.token) : '';
    if (!CONFIG.UPLOAD_TOKEN || !constantTimeEqual_(token, CONFIG.UPLOAD_TOKEN)) {
      return jsonResponse_({ ok: false, message: '上传接口安全校验码 (UPLOAD_TOKEN) 不匹配' });
    }
    const groups = getGroupList_();
    const googleAccount = (e.parameter && e.parameter.googleAccount) ? String(e.parameter.googleAccount).trim() : '';
    const projectId = (e.parameter && e.parameter.projectId) ? String(e.parameter.projectId).trim() : '';
    const accountCount = googleAccount ? getAccountCountOnly_(googleAccount) : 0;
    const projectSummary = projectId ? getProjectConfigSummary_(projectId, googleAccount) : null;
    // 安全加固：仅返回组别名称列表、账号已存数量以及当前项目的脱敏高/低配存在状态（绝不返回 jsonContent 明文凭证！）
    return jsonResponse_({
      ok: true,
      groups: groups,
      accountCount: accountCount,
      projectSummary: projectSummary
    });
  }

  // 默认返回按组查询下载的网页界面
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('GCP 服务账号 JSON 按组下载中心')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 处理 POST 请求：
 * - action = 'uploadJson': 接收浏览器脚本上传的 JSON 数据并按组归档
 * - action = 'queryGroup': 供外部网页通过密码查询指定组的 JSON 列表
 */
function doPost(e) {
  try {
    initSpreadsheet();
    const bodyStr = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const payload = JSON.parse(bodyStr);
    const action = payload.action || 'uploadJson';

    if (action === 'getGroups' || action === 'getAccountStats') {
      const token = String(payload.token || '');
      if (!CONFIG.UPLOAD_TOKEN || !constantTimeEqual_(token, CONFIG.UPLOAD_TOKEN)) {
        return jsonResponse_({ ok: false, message: '安全校验码 (UPLOAD_TOKEN) 不正确' });
      }
      const googleAccount = String(payload.googleAccount || '').trim();
      const projectId = String(payload.projectId || '').trim();
      const accountCount = googleAccount ? getAccountCountOnly_(googleAccount) : 0;
      const projectSummary = projectId ? getProjectConfigSummary_(projectId, googleAccount) : null;
      return jsonResponse_({
        ok: true,
        groups: getGroupList_(),
        accountCount: accountCount,
        projectSummary: projectSummary
      });
    }

    if (action === 'queryGroup') {
      const res = verifyAndGetGroupJson(payload.groupName, payload.password);
      return jsonResponse_(res);
    }

    if (action === 'recordDownload') {
      const res = recordJsonDownload(payload.groupName, payload.password, payload.recordKey);
      return jsonResponse_(res);
    }

    if (action === 'uploadJson') {
      const token = String(payload.token || '');
      if (!CONFIG.UPLOAD_TOKEN || !constantTimeEqual_(token, CONFIG.UPLOAD_TOKEN)) {
        return jsonResponse_({ ok: false, message: '上传接口安全校验码 (UPLOAD_TOKEN) 不正确' });
      }
      const res = saveJsonRecord_(payload);
      return jsonResponse_(res);
    }

    return jsonResponse_({ ok: false, message: '未知的操作类型: ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, message: '服务端处理异常: ' + err.message });
  }
}

/**
 * 读取【配置表】A列的所有组别名称（去重、去空）
 */
function getGroupList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.CONFIG_SHEET_NAME);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const groups = [];
  const seen = {};

  for (let i = 0; i < values.length; i++) {
    const g = String(values[i][0] || '').trim();
    if (g && !seen[g]) {
      seen[g] = true;
      groups.push(g);
    }
  }
  return groups;
}

/**
 * 仅查询某个谷歌账号在【JSON数据总表】中已经生成的 JSON 数量（安全加固：不返回任何凭证内容或记录明细，彻底防止通过上传校验码跨组读取凭证！）
 */
function getAccountCountOnly_(googleAccount) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(CONFIG.MAIN_DATA_SHEET_NAME);
  if (!mainSheet || mainSheet.getLastRow() < 2) {
    return 0;
  }

  const target = String(googleAccount || '').trim().toLowerCase();
  const accValues = mainSheet.getRange(2, 3, mainSheet.getLastRow() - 1, 1).getDisplayValues();
  let count = 0;

  for (let i = 0; i < accValues.length; i++) {
    const acc = String(accValues[i][0] || '').trim().toLowerCase();
    if (acc === target) {
      count++;
    }
  }
  return count;
}

/**
 * 查询指定 GCP 项目 (projectId) 在表格中已建的【低配】与【高配】脱敏配置摘要
 * 安全约束：仅返回脱敏标识（时间、组别、标识名、文件名、下载次数），绝不返回第 9 列 jsonContent 私钥/密钥明文！
 */
function getProjectConfigSummary_(projectId, googleAccount) {
  const cleanProj = String(projectId || '').trim().toLowerCase();
  if (!cleanProj) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(CONFIG.MAIN_DATA_SHEET_NAME);
  if (!mainSheet || mainSheet.getLastRow() < 2) {
    return {
      projectId: projectId,
      lowCount: 0,
      highCount: 0,
      lowConfigs: [],
      highConfigs: []
    };
  }

  ensureDownloadCountHeader_(mainSheet);
  const rows = mainSheet.getRange(2, 1, mainSheet.getLastRow() - 1, DATA_HEADERS.length).getDisplayValues();
  const lowConfigs = [];
  const highConfigs = [];
  const targetAcc = String(googleAccount || '').trim().toLowerCase();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowAcc = String(r[2] || '').trim().toLowerCase();
    // 若传入了当前谷歌账号，仅匹配当前谷歌账号下的项目记录
    if (targetAcc && rowAcc && rowAcc !== targetAcc) continue;

    const rowProjCol = String(r[6] || '').trim();
    const rowProjLower = rowProjCol.toLowerCase();
    const rowEmailCol = String(r[5] || '').trim();
    const rowEmailLower = rowEmailCol.toLowerCase();

    const isSameProject =
      rowProjLower === cleanProj ||
      rowProjLower.indexOf('(' + cleanProj + ')') !== -1 ||
      rowEmailLower.indexOf('@' + cleanProj + '.iam.gserviceaccount.com') !== -1;

    if (!isSameProject) continue;

    const isHigh =
      rowProjCol.indexOf('高配') !== -1 ||
      rowEmailCol.indexOf('高配') !== -1 ||
      rowEmailLower.indexOf('.apps.googleusercontent.com') !== -1;

    const metaItem = {
      genDate: String(r[0] || ''),
      groupName: String(r[1] || ''),
      clientEmail: rowEmailCol,
      projectId: rowProjCol,
      fileName: String(r[7] || ''),
      downloadCount: Math.max(0, parseInt(String(r[10] || '0').trim(), 10) || 0)
    };

    if (isHigh) {
      highConfigs.push(metaItem);
    } else {
      lowConfigs.push(metaItem);
    }
  }

  return {
    projectId: projectId,
    lowCount: lowConfigs.length,
    highCount: highConfigs.length,
    lowConfigs: lowConfigs,
    highConfigs: highConfigs
  };
}

/**
 * 过滤并清理表格公式注入危险前缀（防范 =, +, -, @, Tab, 换行 等引发的公式注入攻击）
 */
function sanitizeFormulaCell_(val) {
  const str = String(val == null ? '' : val).trim();
  // 剥离所有前导空白及公式触发字符 (=, +, -, @, |, \t, \r, \n)
  return str.replace(/^[\s=+\-@|\t\r\n']+/, '');
}

/**
 * 以纯文本格式 (@) 安全追加一行数据，双重阻断 Google 表格公式解析
 */
function appendSafeTextRow_(sheet, rowValues) {
  const safeRow = rowValues.map(function (cell, idx) {
    // 第9列 (idx === 8) 为合法 JSON 字符串（已通过 JSON.parse 校验并以 '{' 开头），其余列全部清理公式前缀
    if (idx === 8) {
      const s = String(cell == null ? '' : cell);
      return /^[=+\-@]/.test(s.trim()) ? "'" + s : s;
    }
    return sanitizeFormulaCell_(cell);
  });
  const nextRow = sheet.getLastRow() + 1;
  const range = sheet.getRange(nextRow, 1, 1, safeRow.length);
  range.setNumberFormat('@');
  range.setValues([safeRow]);
}

/**
 * 生成随机高强度独立组密码
 */
function generateRandomPassword_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < (len || 10); i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/**
 * 恒定时间字符串比对（防止时序侧信道猜解密码/Token）
 */
function constantTimeEqual_(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  if (strA.length === 0 || strA.length !== strB.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 保存上传的 JSON 记录到【JSON数据总表】以及对应的【组别专属分表】
 */
function saveJsonRecord_(data) {
  const groupName = sanitizeFormulaCell_(data.groupName).replace(/[\\/?*\[\]:]/g, '').slice(0, 40);
  const googleAccount = sanitizeFormulaCell_(data.googleAccount).slice(0, 120);
  const registrant = sanitizeFormulaCell_(data.registrant).slice(0, 60);
  // 如果账号人未填或勾选了与注册人一致，则自动使用注册人
  const accountOwner = sanitizeFormulaCell_(data.accountOwner || registrant).slice(0, 60);
  const jsonContentRaw = String(data.jsonContent || '').trim();

  if (!groupName) {
    return { ok: false, message: '请选择所属组别！' };
  }
  if (!googleAccount) {
    return { ok: false, message: '谷歌账号不能为空！' };
  }
  if (!registrant) {
    return { ok: false, message: '注册人不能为空！' };
  }
  if (!jsonContentRaw) {
    return { ok: false, message: 'JSON 文件内容不能为空！' };
  }

  // 解析并校验 JSON 内容，自动识别【低配(服务账号)】或【高级(OAuth installed/web)】
  let parsedJson;
  try {
    parsedJson = JSON.parse(jsonContentRaw);
  } catch (err) {
    return { ok: false, message: '上传的内容不是合法的 JSON 格式：' + err.message };
  }

  const oauthNode = parsedJson.installed || parsedJson.web || null;
  const isHighConfig = Boolean(oauthNode && oauthNode.client_id);
  const levelPrefix = isHighConfig ? '【高配】' : '【低配】';

  const now = new Date();
  const timeZone = Session.getScriptTimeZone() || 'Asia/Shanghai';
  const genDate = sanitizeFormulaCell_(data.genDate || Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm:ss'));
  const dateOnly = Utilities.formatDate(now, timeZone, 'yyyyMMdd');
  const randSuffix = Math.random().toString(36).substring(2, 6);
  const defaultSlug = (isHighConfig ? 'gaopei-' : 'dipei-') + dateOnly + '-' + randSuffix;

  const rawClientEmail = sanitizeFormulaCell_(
    isHighConfig
      ? String(data.clientEmail || oauthNode.client_id || '').trim()
      : String(parsedJson.client_email || data.clientEmail || '').trim()
  );
  const clientEmail = sanitizeFormulaCell_(
    (isHighConfig && !rawClientEmail.includes('高配'))
      ? ('【高配OAuth-免分享表格】' + defaultSlug + ' | ' + rawClientEmail)
      : rawClientEmail
  );

  const rawProjectId = sanitizeFormulaCell_(
    isHighConfig
      ? String(data.projectId || oauthNode.project_id || '').trim()
      : String(data.projectId || parsedJson.project_id || '').trim()
  );
  const projectId = sanitizeFormulaCell_(
    (rawProjectId.includes('高配') || rawProjectId.includes('低配'))
      ? rawProjectId
      : (rawProjectId ? (levelPrefix + defaultSlug + ' (' + rawProjectId + ')') : (levelPrefix + defaultSlug))
  );

  const privateKeyId = sanitizeFormulaCell_(
    isHighConfig
      ? String(oauthNode.client_id || '').trim()
      : String(parsedJson.private_key_id || '').trim()
  );
  const formattedJson = isHighConfig ? JSON.stringify(parsedJson) : JSON.stringify(parsedJson, null, 2);

  const safeAccountPrefix = googleAccount.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '');
  const rawFileName = sanitizeFormulaCell_(String(data.fileName || '').trim());
  const fileName = sanitizeFormulaCell_(
    rawFileName
      ? ((rawFileName.includes('高配') || rawFileName.includes('低配')) ? rawFileName : (levelPrefix + rawFileName))
      : (levelPrefix + defaultSlug + '_' + groupName + '_' + (safeAccountPrefix || 'key') + '.json')
  );

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 使用文档级互斥锁（独立于脚本验证锁）串行化表格写入，彻底防止并发上传时 getLastRow()+1 冲突覆盖同一行数据
  const writeLock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!writeLock.tryLock(30000)) {
    return {
      ok: false,
      message: '当前并发上传较多，表格写入锁繁忙，请稍候 2 秒再点击重新上传！'
    };
  }

  try {
    initSpreadsheet();
    const mainSheet = ss.getSheetByName(CONFIG.MAIN_DATA_SHEET_NAME);

    // 防重复检查：如果 private_key_id 相同，提示已上传过
    if (privateKeyId && mainSheet.getLastRow() >= 2) {
      const existingKeys = mainSheet.getRange(2, 10, mainSheet.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < existingKeys.length; i++) {
        if (String(existingKeys[i][0]).trim() === privateKeyId) {
          return {
            ok: false,
            duplicate: true,
            message: '该 JSON 密钥 (private_key_id: ' + privateKeyId.slice(0, 8) + '...) 已经上传过了，无需重复上传！'
          };
        }
      }
    }

    // 确保该组别存在于【配置表】中，若不存在则自动补充（自动生成高强度随机独立密码）
    ensureGroupExistsInConfig_(ss, groupName);

    const rowData = [
      genDate,
      groupName,
      googleAccount,
      accountOwner,
      registrant,
      clientEmail,
      projectId,
      fileName,
      formattedJson,
      privateKeyId,
      '0'
    ];

    // 1. 纯文本安全写入【JSON数据总表】（彻底阻断表格公式注入）并按组别归类排序
    ensureDownloadCountHeader_(mainSheet);
    appendSafeTextRow_(mainSheet, rowData);
    sortMainSheetByGroup();

    // 2. 写入该组独立的分表（如 "组别_一组"），让同一组的 JSON 完全聚合在一张表里
    if (CONFIG.AUTO_CREATE_GROUP_SHEET) {
      const safeSheetSuffix = groupName.replace(/[:\/\\?\*\[\]]/g, '_').slice(0, 50);
      const groupSheetName = '组别_' + safeSheetSuffix;
      let groupSheet = ss.getSheetByName(groupSheetName);
      if (!groupSheet) {
        groupSheet = ss.insertSheet(groupSheetName);
        formatDataSheetHeader_(groupSheet);
      } else {
        ensureDownloadCountHeader_(groupSheet);
      }
      appendSafeTextRow_(groupSheet, rowData);
    }

    SpreadsheetApp.flush();
  } finally {
    writeLock.releaseLock();
  }

  return {
    ok: true,
    message: '上传成功！已归入【' + groupName + '】',
    summary: {
      genDate: genDate,
      groupName: groupName,
      googleAccount: googleAccount,
      accountOwner: accountOwner,
      registrant: registrant,
      clientEmail: clientEmail,
      projectId: projectId,
      fileName: fileName
    }
  };
}

/**
 * 将【JSON数据总表】中的数据按“所属组别(B列)”升序 + “生成日期(A列)”降序排列，保证同组数据归类在一起
 */
function sortMainSheetByGroup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(CONFIG.MAIN_DATA_SHEET_NAME);
  if (!mainSheet) return;

  const lastRow = mainSheet.getLastRow();
  const lastCol = mainSheet.getLastColumn();
  if (lastRow > 2) {
    const range = mainSheet.getRange(2, 1, lastRow - 1, lastCol);
    range.sort([
      { column: 2, ascending: true },  // 按 B 列（所属组别）归类到一起
      { column: 1, ascending: false }  // 同组内按 A 列（生成日期）最新在前
    ]);
  }
}

/**
 * 若上传的组别不在配置表中，自动加入配置表，并生成高强度随机独立密码（不再默认等于组名）
 */
function ensureGroupExistsInConfig_(ss, groupName) {
  const sheet = ss.getSheetByName(CONFIG.CONFIG_SHEET_NAME);
  if (!sheet) return;
  const groups = getGroupList_();
  if (groups.indexOf(groupName) === -1) {
    appendSafeTextRow_(sheet, [
      groupName,
      generateRandomPassword_(10),
      '自动创建组别（已自动生成独立随机密码，请管理员在B列查看或修改）'
    ]);
  }
}

/**
 * 一键将【配置表】中所有为空或等于组名的弱密码升级为 10 位随机强密码
 */
function upgradeWeakGroupPasswords() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.CONFIG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return '配置表暂无组别数据';

  const lastRow = sheet.getLastRow();
  const range = sheet.getRange(2, 1, lastRow - 1, 3);
  range.setNumberFormat('@');
  const values = range.getValues();
  let updated = 0;

  for (let i = 0; i < values.length; i++) {
    const gName = String(values[i][0] || '').trim();
    const gPass = String(values[i][1] || '').trim();
    if (gName && (!gPass || gPass === gName)) {
      values[i][1] = generateRandomPassword_(10);
      updated++;
    }
  }

  if (updated > 0) {
    range.setValues(values);
  }
  return '已升级 ' + updated + ' 个组别的独立随机强密码！';
}

/**
 * 组密码安全验证核心（供查询列表与记录下载次数共同调用）：
 * 1. 抢锁失败即拒绝（Fail-Closed）：必须在密码校验前成功获取短时原子锁 (authLock)，抢锁失败直接拒绝，绝不无锁继续执行。
 * 2. 锁外休眠 + 独立锁域：仅在锁内完成 <20ms 的虚拟排队时间戳 (nextAllowedTs) 原子扣减与密码比对，释放锁后再执行 Utilities.sleep，
 *    既保证所有密码尝试严格按时间槽串行限流，又绝不阻塞上传接口使用的表格写入锁。
 * 3. 防恶意锁组（DoS）：当排队水位超过 10 秒时仅拒绝溢出并发请求，不实施 10 分钟整组死锁，合法用户在冷却槽（≤3秒）后即可正常登录。
 */
function verifyGroupPassword_(groupNameInput, passwordInput) {
  initSpreadsheet();
  const groupName = String(groupNameInput || '').trim();
  const password = String(passwordInput || '').trim();

  if (!groupName) {
    return { ok: false, message: '请输入组别名称！' };
  }
  if (!password) {
    return { ok: false, message: '请输入访问密码！' };
  }

  const cache = CacheService.getScriptCache();
  if (!cache) {
    return { ok: false, message: '系统缓存服务暂不可用，请稍后重试！' };
  }

  const safeGroupKey = Utilities.base64EncodeWebSafe(groupName).slice(0, 36);
  const groupFailKey = 'GRP_FAIL_' + safeGroupKey;
  const groupCooldownKey = 'GRP_CD_TS_' + safeGroupKey;

  let callerKey = '';
  try {
    callerKey = String(Session.getTemporaryActiveUserKey() || '').trim();
  } catch (_) {}
  const callerRateKey = callerKey ? ('CALLER_FAIL_' + callerKey.slice(0, 24) + '_' + safeGroupKey) : '';

  // 必须在校验前获取短时原子状态锁（仅持有约 10~20ms，绝不在锁内 sleep）；若抢锁失败直接拒绝（Fail-Closed）
  const authLock = LockService.getScriptLock();
  if (!authLock.tryLock(5000)) {
    return {
      ok: false,
      message: '当前验证请求繁忙，请稍候几秒再试！'
    };
  }

  let ss;
  let groupFound = false;
  let passwordMatched = false;
  let weakOrEmptyConfigPassword = false;
  let sleepAfterReleaseMs = 0;

  try {
    if (callerRateKey) {
      const callerFails = Number(cache.get(callerRateKey) || '0');
      if (callerFails >= 5) {
        return {
          ok: false,
          message: '安全限制：您当前会话连续输错密码已达 5 次，请等待 10 分钟后再试！'
        };
      }
    }

    const now = Date.now();
    const grpFailCount = Number(cache.get(groupFailKey) || '0');
    const nextAllowedTs = Number(cache.get(groupCooldownKey) || '0');

    // 若当前组别的串行排队冷却水位已超过 10 秒，直接在比对密码前拒绝并发爆破请求
    if (nextAllowedTs - now > 10000) {
      return {
        ok: false,
        message: '当前组别验证请求过于频繁，请稍候几秒再试！'
      };
    }

    ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName(CONFIG.CONFIG_SHEET_NAME);
    const configLastRow = configSheet.getLastRow();

    if (configLastRow < 2) {
      return { ok: false, message: '表格配置表中尚未配置任何组别！' };
    }

    const configRows = configSheet.getRange(2, 1, configLastRow - 1, 2).getValues();

    for (let i = 0; i < configRows.length; i++) {
      const cfgGroup = String(configRows[i][0] || '').trim();
      const cfgPassRaw = String(configRows[i][1] || '').trim();

      if (cfgGroup === groupName) {
        groupFound = true;
        // 严禁空密码或密码等于组名
        if (!cfgPassRaw || cfgPassRaw === cfgGroup) {
          weakOrEmptyConfigPassword = true;
          break;
        }
        if (constantTimeEqual_(password, cfgPassRaw)) {
          passwordMatched = true;
          break;
        }
      }
    }

    if (weakOrEmptyConfigPassword) {
      return {
        ok: false,
        message: '安全策略拦截：该组别在【配置表】B列未设置独立密码（密码不能留空或与组名相同）。请管理员在表格【配置表】B列设置独立密码后再试！'
      };
    }

    if (!groupFound || !passwordMatched) {
      const nextFailCount = grpFailCount + 1;
      const penaltyMs = nextFailCount >= 5 ? 3000 : 1500;
      const scheduledTs = Math.max(now, nextAllowedTs) + penaltyMs;
      sleepAfterReleaseMs = Math.min(12000, Math.max(penaltyMs, scheduledTs - now));

      cache.put(groupCooldownKey, String(scheduledTs), 600);
      cache.put(groupFailKey, String(nextFailCount), 600);
      if (callerRateKey) {
        const nextCallerFails = Number(cache.get(callerRateKey) || '0') + 1;
        cache.put(callerRateKey, String(nextCallerFails), 600);
      }
    } else {
      // 密码正确：若仍处于上一笔错误尝试的短暂时间槽内，同样对齐该时间槽后再放行，随后清空错误计数
      if (nextAllowedTs > now) {
        sleepAfterReleaseMs = Math.min(10000, nextAllowedTs - now);
      }
      cache.remove(groupCooldownKey);
      cache.remove(groupFailKey);
      if (callerRateKey) {
        cache.remove(callerRateKey);
      }
    }
  } finally {
    authLock.releaseLock();
  }

  // 在锁外执行串行槽延迟（绝不占用任何锁资源，完全不影响并发上传）
  if (sleepAfterReleaseMs > 0) {
    Utilities.sleep(sleepAfterReleaseMs);
  }

  if (!groupFound || !passwordMatched) {
    return {
      ok: false,
      message: '组别名称不存在或访问密码错误，请核对后重试！'
    };
  }

  return { ok: true, groupName: groupName, ss: ss };
}

/**
 * 网页端按组查询 JSON 列表
 */
function verifyAndGetGroupJson(groupNameInput, passwordInput) {
  const authRes = verifyGroupPassword_(groupNameInput, passwordInput);
  if (!authRes || !authRes.ok) {
    return authRes;
  }
  const groupName = authRes.groupName;
  const ss = authRes.ss || SpreadsheetApp.getActiveSpreadsheet();

  // 验证通过，仅读取属于该组别的 JSON 数据
  const mainSheet = ss.getSheetByName(CONFIG.MAIN_DATA_SHEET_NAME);
  ensureDownloadCountHeader_(mainSheet);
  const lastRow = mainSheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, groupName: groupName, items: [] };
  }

  const rows = mainSheet.getRange(2, 1, lastRow - 1, DATA_HEADERS.length).getDisplayValues();
  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowGroup = String(row[1] || '').trim();
    if (rowGroup === groupName) {
      const jsonStr = String(row[8] || '');
      const emailStr = String(row[5] || '');
      const isHigh = jsonStr.indexOf('"installed"') !== -1 ||
                     jsonStr.indexOf('"client_secret"') !== -1 ||
                     emailStr.indexOf('.apps.googleusercontent.com') !== -1;
      const lvlPrefix = isHigh ? '【高配】' : '【低配】';
      const rawProj = String(row[6] || '').trim();
      const displayProj = (rawProj.indexOf('高配') !== -1 || rawProj.indexOf('低配') !== -1)
        ? rawProj
        : (lvlPrefix + (rawProj || '-'));
      const rawFn = String(row[7] || '').trim() || (row[1] + '_' + (row[2] || 'account') + '.json');
      const displayFn = (rawFn.indexOf('高配') !== -1 || rawFn.indexOf('低配') !== -1)
        ? rawFn
        : (lvlPrefix + rawFn);
      const dlCount = Math.max(0, parseInt(String(row[10] || '0').trim(), 10) || 0);
      const recordKey = String(row[9] || '').trim() || String(row[5] || '').trim() || String(row[7] || '').trim() || String(i + 2);

      items.push({
        id: i + 2,
        recordKey: recordKey,
        genDate: row[0],
        groupName: row[1],
        googleAccount: row[2],
        accountOwner: row[3],
        registrant: row[4],
        clientEmail: row[5],
        projectId: displayProj,
        fileName: displayFn,
        jsonContent: row[8],
        privateKeyId: String(row[9] || '').trim(),
        downloadCount: dlCount
      });
    }
  }

  return {
    ok: true,
    groupName: groupName,
    count: items.length,
    items: items
  };
}

/**
 * 在单个工作表中定位目标记录并将第 11 列（下载次数）原子 +1
 */
function incrementSheetDownloadCount_(sheet, groupName, recordKey) {
  if (!sheet) return -1;
  ensureDownloadCountHeader_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const rows = sheet.getRange(2, 1, lastRow - 1, DATA_HEADERS.length).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rGroup = String(r[1] || '').trim();
    if (rGroup !== groupName) continue;

    const rKeyId = String(r[9] || '').trim();
    const rEmail = String(r[5] || '').trim();
    const rFile = String(r[7] || '').trim();
    const rowNumberStr = String(i + 2);

    if (
      (rKeyId && rKeyId === recordKey) ||
      (rEmail && rEmail === recordKey) ||
      (rFile && rFile === recordKey) ||
      rowNumberStr === recordKey
    ) {
      const curCount = Math.max(0, parseInt(String(r[10] || '0').trim(), 10) || 0);
      const nextCount = curCount + 1;
      const cell = sheet.getRange(i + 2, 11);
      cell.setNumberFormat('@');
      cell.setValue(String(nextCount));
      return nextCount;
    }
  }
  return -1;
}

/**
 * 记录某个 JSON 文件的下载次数 (+1)，同步更新【JSON数据总表】与【组别_xxx】子表
 */
function recordJsonDownload(groupNameInput, passwordInput, recordKeyInput) {
  const groupName = String(groupNameInput || '').trim();
  const password = String(passwordInput || '').trim();
  const recordKey = String(recordKeyInput || '').trim();

  if (!groupName || !password || !recordKey) {
    return { ok: false, message: '参数不完整' };
  }

  // 复用轻量级组密码安全验证（验证通过后才允许更新该组下的下载次数，无需重复读取整张总表）
  const authRes = verifyGroupPassword_(groupName, password);
  if (!authRes || !authRes.ok) {
    return { ok: false, message: (authRes && authRes.message) || '组密码验证未通过' };
  }

  const writeLock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!writeLock.tryLock(15000)) {
    return { ok: false, message: '表格写入繁忙，请稍后重试' };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const mainSheet = ss.getSheetByName(CONFIG.MAIN_DATA_SHEET_NAME);
    const updatedCount = incrementSheetDownloadCount_(mainSheet, groupName, recordKey);

    if (CONFIG.AUTO_CREATE_GROUP_SHEET) {
      const safeSheetSuffix = groupName.replace(/[:\/\\?\*\[\]]/g, '_').slice(0, 50);
      const groupSheet = ss.getSheetByName('组别_' + safeSheetSuffix);
      if (groupSheet) {
        incrementSheetDownloadCount_(groupSheet, groupName, recordKey);
      }
    }

    SpreadsheetApp.flush();
    return {
      ok: true,
      downloadCount: updatedCount >= 0 ? updatedCount : 1
    };
  } finally {
    writeLock.releaseLock();
  }
}

/**
 * 一键为表格中的历史记录补齐【高配】/【低配】标识（可在表格顶部菜单点击运行）
 */
function backfillConfigLevelTags() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  let updatedCount = 0;

  for (let s = 0; s < sheets.length; s++) {
    const sheet = sheets[s];
    const name = sheet.getName();
    if (name !== CONFIG.MAIN_DATA_SHEET_NAME && name.indexOf('组别_') !== 0) continue;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;

    const range = sheet.getRange(2, 1, lastRow - 1, DATA_HEADERS.length);
    const values = range.getValues();
    let changed = false;

    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      const emailStr = String(r[5] || '').trim();
      const projStr = String(r[6] || '').trim();
      const fnStr = String(r[7] || '').trim();
      const jsonStr = String(r[8] || '');

      const isHigh = jsonStr.indexOf('"installed"') !== -1 ||
                     jsonStr.indexOf('"client_secret"') !== -1 ||
                     emailStr.indexOf('.apps.googleusercontent.com') !== -1;
      const lvlPrefix = isHigh ? '【高配】' : '【低配】';

      if (projStr && projStr.indexOf('高配') === -1 && projStr.indexOf('低配') === -1) {
        r[6] = lvlPrefix + projStr;
        changed = true;
        updatedCount++;
      }
      if (isHigh && emailStr && emailStr.indexOf('高配') === -1) {
        r[5] = '【高配OAuth-免分享表格】' + emailStr;
        changed = true;
      }
      if (fnStr && fnStr.indexOf('高配') === -1 && fnStr.indexOf('低配') === -1) {
        r[7] = lvlPrefix + fnStr;
        changed = true;
      }
    }

    if (changed) {
      range.setValues(values);
    }
  }

  return '已为历史数据补齐【高配/低配】标识（共更新 ' + updatedCount + ' 处）！';
}

/**
 * 构造统一 JSON 响应
 */
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
