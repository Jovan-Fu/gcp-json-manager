/**
 * 页面主环境拦截器 (运行于 MAIN world, document_start)
 * 作用：当 Google Cloud Console 生成并触发下载：
 *  - 【低配】服务账号密钥 JSON ({"type": "service_account", ...})
 *  - 【高级】OAuth 2.0 桌面客户端 JSON ({"installed": {"client_id": ..., "client_secret": ...}})
 * 全方位拦截 (Blob / createObjectURL / DataURL / a.click / dispatchEvent / XHR / Fetch)，
 * 自动在内存中截获生成的 JSON 配置文件！
 */
(function () {
  if (window.__GCP_JSON_INTERCEPTOR_INSTALLED__) return;
  window.__GCP_JSON_INTERCEPTOR_INSTALLED__ = true;

  let lastCapturedKeyId = '';

  // 安全闸门：仅在自动流水线处于密钥创建/OAuth客户端创建阶段时才允许捕获凭证，停止流水线后立即静默
  function isCaptureAllowed() {
    try {
      const activeStage = sessionStorage.getItem('GCP_HELPER_ONECLICK_STAGE') || '';
      return (
        activeStage === 'STAGE_5_CREATE_KEY' ||
        activeStage === 'STAGE_6_OAUTH_CONSENT' ||
        activeStage === 'STAGE_7_OAUTH_CLIENT'
      );
    } catch (_) {
      return false;
    }
  }

  function notifyCapturedJson(rawText, source) {
    if (!isCaptureAllowed()) return;
    if (!rawText || typeof rawText !== 'string') return;
    try {
      const trimmed = rawText.trim();
      if (!trimmed.startsWith('{')) return;
      const obj = JSON.parse(trimmed);
      if (!obj || typeof obj !== 'object') return;

      // 1. 识别【低配】服务账号密钥 JSON（必须完整绑定并精确匹配 expectedProjectId 与完整 expectedSaEmail）
      if (obj.type === 'service_account' || (obj.private_key && obj.client_email)) {
        const activeStage = sessionStorage.getItem('GCP_HELPER_ONECLICK_STAGE') || '';
        const expectedProjectId = (sessionStorage.getItem('GCP_HELPER_ONECLICK_PROJECT') || '').trim().toLowerCase();
        const expectedSaSlug = (sessionStorage.getItem('GCP_HELPER_EXPECTED_SA_SLUG') || '').trim().toLowerCase();
        const expectedSaEmail = (sessionStorage.getItem('GCP_HELPER_EXPECTED_SA_EMAIL') || '').trim().toLowerCase();
        const actualEmail = String(obj.client_email || '').trim().toLowerCase();
        const actualProjectId = String(obj.project_id || '').trim().toLowerCase();
        const canonicalExpectedEmail =
          expectedSaSlug && expectedProjectId ? `${expectedSaSlug}@${expectedProjectId}.iam.gserviceaccount.com` : '';

        if (
          activeStage !== 'STAGE_5_CREATE_KEY' ||
          !expectedProjectId ||
          !expectedSaSlug ||
          !canonicalExpectedEmail ||
          expectedSaEmail !== canonicalExpectedEmail ||
          actualProjectId !== expectedProjectId ||
          actualEmail !== canonicalExpectedEmail
        ) {
          return;
        }
        const keyId = 'LOW_' + (obj.private_key_id || obj.client_email || trimmed.slice(0, 60));
        if (keyId === lastCapturedKeyId) return;
        lastCapturedKeyId = keyId;

        const formatted = JSON.stringify(obj, null, 2);
        window.dispatchEvent(
          new CustomEvent('GCP_SERVICE_ACCOUNT_JSON_CAPTURED', {
            detail: {
              configLevel: '低配',
              jsonText: formatted,
              clientEmail: obj.client_email || '',
              projectId: obj.project_id || '',
              privateKeyId: obj.private_key_id || '',
              source: source
            }
          })
        );
        return;
      }

      // 2. 识别【高级】OAuth 客户端 JSON ({"installed": {...}} 或 {"web": {...}})，同样绑定校验目标项目 ID
      const oauthNode = obj.installed || obj.web;
      if (oauthNode && oauthNode.client_id && oauthNode.client_secret) {
        const activeStage = sessionStorage.getItem('GCP_HELPER_ONECLICK_STAGE') || '';
        const expectedProjectId = (sessionStorage.getItem('GCP_HELPER_ONECLICK_PROJECT') || '').trim();
        const urlProjectId = (new URLSearchParams(window.location.search).get('project') || '').trim();
        const actualProjectId = String(oauthNode.project_id || '').trim();
        if (
          (activeStage !== 'STAGE_6_OAUTH_CONSENT' && activeStage !== 'STAGE_7_OAUTH_CLIENT') ||
          !expectedProjectId ||
          (urlProjectId && urlProjectId.toLowerCase() !== expectedProjectId.toLowerCase()) ||
          (actualProjectId && actualProjectId.toLowerCase() !== expectedProjectId.toLowerCase())
        ) {
          return;
        }
        const keyId = 'HIGH_' + oauthNode.client_id;
        if (keyId === lastCapturedKeyId) return;
        lastCapturedKeyId = keyId;

        // 统一规范化为 installed 结构并确保包含 redirect_uris: ["http://localhost"]
        const normalizedObj = {
          installed: {
            client_id: oauthNode.client_id,
            project_id: oauthNode.project_id || expectedProjectId,
            auth_uri: oauthNode.auth_uri || 'https://accounts.google.com/o/oauth2/auth',
            token_uri: oauthNode.token_uri || 'https://oauth2.googleapis.com/token',
            auth_provider_x509_cert_url:
              oauthNode.auth_provider_x509_cert_url || 'https://www.googleapis.com/oauth2/v1/certs',
            client_secret: oauthNode.client_secret,
            redirect_uris:
              Array.isArray(oauthNode.redirect_uris) && oauthNode.redirect_uris.length > 0
                ? oauthNode.redirect_uris
                : ['http://localhost']
          }
        };

        const formatted = JSON.stringify(normalizedObj);
        window.dispatchEvent(
          new CustomEvent('GCP_SERVICE_ACCOUNT_JSON_CAPTURED', {
            detail: {
              configLevel: '高级',
              jsonText: formatted,
              clientEmail: oauthNode.client_id,
              projectId: oauthNode.project_id || '',
              privateKeyId: oauthNode.client_id,
              source: source
            }
          })
        );
      }
    } catch (_) {
      // 非 JSON 内容忽略
    }
  }

  function decodeBase64Utf8(b64Str) {
    const clean = b64Str.replace(/\\n/g, '').replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(clean), function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join('')
    );
  }

  function inspectApiText(text, source) {
    if (!isCaptureAllowed()) return;
    if (!text || typeof text !== 'string') return;

    // 1. 直接匹配服务账号 JSON 或 OAuth installed/web JSON
    if (
      (text.includes('"service_account"') && text.includes('"private_key"')) ||
      (text.includes('"client_id"') && text.includes('"client_secret"'))
    ) {
      notifyCapturedJson(text, source + '_Direct');
    }

    // 2. 匹配服务账号 base64 编码的 privateKeyData 或 keyData
    if (text.includes('privateKeyData') || text.includes('keyData')) {
      try {
        const regex = /"(?:privateKeyData|keyData)"\s*:\s*"([A-Za-z0-9+/=_\\-]+)"/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match[1] && match[1].length > 60) {
            try {
              const decoded = decodeBase64Utf8(match[1]);
              notifyCapturedJson(decoded, source + '_Base64');
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // 3. 匹配 GCP 创建 OAuth 客户端接口返回中的 clientId 与 clientSecret (GOCSPX-...)
    if (text.includes('.apps.googleusercontent.com') && text.includes('GOCSPX-')) {
      try {
        const idMatch = text.match(/([0-9]{6,}-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com)/);
        const secretMatch = text.match(/(GOCSPX-[a-zA-Z0-9_-]{10,})/);
        if (idMatch && idMatch[1] && secretMatch && secretMatch[1]) {
          const urlParams = new URLSearchParams(window.location.search);
          const projId = urlParams.get('project') || '';
          const constructed = JSON.stringify({
            installed: {
              client_id: idMatch[1],
              project_id: projId,
              auth_uri: 'https://accounts.google.com/o/oauth2/auth',
              token_uri: 'https://oauth2.googleapis.com/token',
              auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
              client_secret: secretMatch[1],
              redirect_uris: ['http://localhost']
            }
          });
          notifyCapturedJson(constructed, source + '_OAuthAPI');
        }
      } catch (_) {}
    }
  }

  function inspectAnchorElement(anchorEl, source) {
    try {
      if (!anchorEl || anchorEl.tagName !== 'A') return;
      const href = anchorEl.getAttribute('href') || anchorEl.href || '';
      if (href.startsWith('data:')) {
        const commaIdx = href.indexOf(',');
        if (commaIdx !== -1) {
          const meta = href.slice(0, commaIdx);
          const dataPart = href.slice(commaIdx + 1);
          const raw = meta.includes(';base64')
            ? decodeBase64Utf8(decodeURIComponent(dataPart))
            : decodeURIComponent(dataPart);
          notifyCapturedJson(raw, source);
        }
      }
    } catch (_) {}
  }

  // 1. 拦截 URL.createObjectURL (捕获任何 Blob / File 下载)
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    try {
      if (obj && typeof obj.text === 'function') {
        obj.text().then(function (txt) {
          inspectApiText(txt, 'Blob_createObjectURL');
        }).catch(function () {});
      } else if (obj instanceof Blob && typeof FileReader !== 'undefined') {
        const reader = new FileReader();
        reader.onload = function () {
          inspectApiText(String(reader.result || ''), 'Blob_FileReader');
        };
        reader.readAsText(obj);
      }
    } catch (_) {}
    return origCreateObjectURL.apply(this, arguments);
  };

  // 2. 拦截 <a download> 的 click() 与 dispatchEvent()
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    inspectAnchorElement(this, 'Anchor_click');
    return origAnchorClick.apply(this, arguments);
  };

  const origDispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (evt) {
    try {
      if (this && this.tagName === 'A' && evt && evt.type === 'click') {
        inspectAnchorElement(this, 'Anchor_dispatchEvent');
      }
    } catch (_) {}
    return origDispatchEvent.apply(this, arguments);
  };

  // 3. 拦截 XMLHttpRequest 响应
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        let txt = '';
        if (!this.responseType || this.responseType === 'text') {
          txt = this.responseText || '';
        } else if (this.responseType === 'json' && this.response) {
          txt = JSON.stringify(this.response);
        }
        if (txt) {
          inspectApiText(txt, 'XHR');
        }
      } catch (_) {}
    });
    return origXhrSend.apply(this, arguments);
  };

  // 4. 拦截 fetch 响应
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      return origFetch.apply(this, arguments).then(function (response) {
        try {
          const clone = response.clone();
          clone.text().then(function (txt) {
            if (txt) inspectApiText(txt, 'Fetch');
          }).catch(function () {});
        } catch (_) {}
        return response;
      });
    };
  }
})();
