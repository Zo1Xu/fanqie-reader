'use strict';

const vscode = require('vscode');

class LoginViewProvider {
  constructor(context, officialLogin, callbacks = {}) {
    this.context = context;
    this.officialLogin = officialLogin;
    this.callbacks = callbacks;
    this.view = undefined;
    this.cancellation = undefined;
    this.running = false;
    this.phoneBusy = false;
    this.qrSource = '';
    this.qrPreview = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = getLoginHtml();
    view.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'startQr') {
        await this.startQrLogin();
      } else if (message.type === 'cancelQr') {
        this.cancelQr();
      } else if (message.type === 'openQrPreview') {
        this.#showQrPreview(true);
      } else if (message.type === 'sendSms') {
        await this.sendSms(message);
      } else if (message.type === 'submitSmsCode') {
        await this.submitSmsCode(message);
      } else if (message.type === 'openVerification') {
        await this.openVerification();
      } else if (message.type === 'cancelPhone') {
        await this.cancelPhoneLogin();
      } else if (message.type === 'openLegal') {
        const urls = {
          agreement: 'https://fanqienovel.com/protocal/agreement',
          privacy: 'https://fanqienovel.com/protocal/privacy',
        };
        const url = urls[message.kind];
        if (url) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
      } else if (message.type === 'browserLogin') {
        this.cancel();
        await vscode.commands.executeCommand('fanqieReader.loginInBrowser');
      } else if (message.type === 'manualCookie') {
        this.cancel();
        await vscode.commands.executeCommand('fanqieReader.setCookie');
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.cancel();
    });
  }

  async focus() {
    // Opening the contributed container is stable even while this view is hidden
    // by its `when` clause. VS Code does not register `<viewId>.focus` until a
    // conditional view already exists, which made the logged-in -> login path fail.
    await vscode.commands.executeCommand(
      'workbench.view.extension.fanqieReaderSidebar',
    );
    this.view?.show(false);
  }

  async startQrLogin() {
    if (this.running) {
      return;
    }
    await this.officialLogin.cancelPhoneLogin();
    this.running = true;
    this.cancellation = { isCancellationRequested: false };
    this.qrSource = '';
    this.#disposeQrPreview();
    this.#post({ type: 'loading', message: '正在生成官方二维码…' });
    try {
      const browserPath = vscode.workspace
        .getConfiguration('fanqieReader')
        .get('browserPath', '');
      const user = await this.officialLogin.loginWithQr({
        browserPath,
        cancellationToken: this.cancellation,
        onQrCode: (source) => {
          this.qrSource = source;
          this.#post({ type: 'qrCode', source });
        },
        onStatus: (message) => this.#post({ type: 'status', message }),
      });
      this.#post({ type: 'success', method: 'qr', name: user.name || '番茄小说账号' });
      this.#disposeQrPreview();
      await this.callbacks.onLoggedIn?.(user);
    } catch (error) {
      if (error?.code !== 'LOGIN_CANCELLED') {
        this.#post({ type: 'error', message: error.message });
      } else {
        this.#post({ type: 'idle' });
      }
      this.#disposeQrPreview();
    } finally {
      this.running = false;
      this.cancellation = undefined;
    }
  }

  async sendSms(message) {
    if (this.phoneBusy) {
      return;
    }
    this.cancelQr();
    this.phoneBusy = true;
    this.#post({ type: 'phoneLoading', action: 'sendSms', message: '正在连接番茄官方登录页…' });
    try {
      const browserPath = vscode.workspace
        .getConfiguration('fanqieReader')
        .get('browserPath', '');
      const result = await this.officialLogin.sendSms(message.phone, {
        browserPath,
        agreed: message.agreed === true,
        onStatus: (status) => this.#post({ type: 'phoneStatus', message: status }),
      });
      if (result.status === 'verification_required') {
        this.#post({
          type: 'verificationRequired',
          purpose: 'sendSms',
          phone: result.phone,
        });
      } else {
        this.#post({ type: 'smsSent', phone: result.phone });
      }
    } catch (error) {
      this.#post({ type: 'phoneError', message: error.message });
    } finally {
      this.phoneBusy = false;
    }
  }

  async submitSmsCode(message) {
    if (this.phoneBusy) {
      return;
    }
    this.phoneBusy = true;
    this.#post({ type: 'phoneLoading', action: 'submitCode', message: '正在验证短信验证码…' });
    try {
      const result = await this.officialLogin.submitSmsCode(message.code, {
        onStatus: (status) => this.#post({ type: 'phoneStatus', message: status }),
      });
      if (result.status === 'verification_required') {
        this.#post({ type: 'verificationRequired', purpose: 'submitCode' });
        return;
      }
      this.#post({
        type: 'success',
        method: 'phone',
        name: result.user.name || '番茄小说账号',
      });
      await this.callbacks.onLoggedIn?.(result.user);
    } catch (error) {
      this.#post({ type: 'phoneError', message: error.message });
    } finally {
      this.phoneBusy = false;
    }
  }

  async openVerification() {
    if (this.phoneBusy) {
      return;
    }
    this.phoneBusy = true;
    this.#post({ type: 'verificationOpening' });
    try {
      const result = await this.officialLogin.completeSecurityVerification({
        onStatus: (status) => this.#post({ type: 'phoneStatus', message: status }),
      });
      if (result.status === 'sms_sent') {
        this.#post({ type: 'smsSent', phone: result.phone });
      } else {
        this.#post({
          type: 'success',
          method: 'phone',
          name: result.user.name || '番茄小说账号',
        });
        await this.callbacks.onLoggedIn?.(result.user);
      }
    } catch (error) {
      this.#post({ type: 'phoneError', message: error.message });
    } finally {
      this.phoneBusy = false;
    }
  }

  async cancelPhoneLogin() {
    await this.officialLogin.cancelPhoneLogin();
    this.#post({ type: 'phoneIdle' });
  }

  cancelQr() {
    if (this.cancellation) {
      this.cancellation.isCancellationRequested = true;
    }
    this.qrSource = '';
    this.#disposeQrPreview();
  }

  cancel() {
    this.cancelQr();
    void this.officialLogin.cancelPhoneLogin();
  }

  #post(message) {
    this.view?.webview.postMessage(message);
  }

  #showQrPreview(reveal) {
    if (!isRasterDataUri(this.qrSource)) {
      return;
    }
    if (this.qrPreview) {
      this.qrPreview.webview.html = getQrPreviewHtml(this.qrSource);
      if (reveal) {
        this.qrPreview.reveal(vscode.ViewColumn.Active, true);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'fanqieReader.qrPreview',
      '番茄阅读：扫码登录',
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );
    this.qrPreview = panel;
    panel.webview.html = getQrPreviewHtml(this.qrSource);
    panel.onDidDispose(() => {
      if (this.qrPreview === panel) {
        this.qrPreview = undefined;
      }
    });
  }

  #disposeQrPreview() {
    const panel = this.qrPreview;
    this.qrPreview = undefined;
    panel?.dispose();
  }
}

function getLoginHtml() {
  const nonce = getNonce();
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;padding:10px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:13px/1.5 var(--vscode-font-family)}
[hidden]{display:none!important}.card{padding:14px;border:1px solid var(--vscode-widget-border);border-radius:10px;background:var(--vscode-sideBarSectionHeader-background)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:12px}.tomato{width:28px;height:28px;flex:0 0 auto;overflow:visible}.title{font-size:15px;font-weight:600}.muted{color:var(--vscode-descriptionForeground)}
.tabs{display:grid;grid-template-columns:1fr 1fr;margin:0 -4px 14px;border-bottom:1px solid var(--vscode-widget-border)}.tab{min-height:34px;padding:6px;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--vscode-descriptionForeground);background:transparent}.tab[aria-selected="true"]{border-bottom-color:var(--vscode-focusBorder);color:var(--vscode-foreground);font-weight:600}
button{min-height:36px;padding:7px 10px;border:1px solid transparent;border-radius:5px;cursor:pointer;font:inherit}button:disabled{cursor:not-allowed;opacity:.6}button:focus-visible,input:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.primary{width:100%;color:var(--vscode-button-foreground);background:var(--vscode-button-background)}.primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}.secondary{width:100%;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.secondary:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}.link{min-height:28px;padding:3px;color:var(--vscode-textLink-foreground);background:transparent}.link:hover{text-decoration:underline}
.qr-wrap{text-align:center}.qr-frame{display:inline-block;max-width:100%;margin:12px auto;padding:16px;border-radius:4px;background:#fff;line-height:0}.qr{display:block;width:auto;height:auto;max-width:100%;margin:0;image-rendering:crisp-edges;image-rendering:pixelated}.qr-fallback{display:inline-block;margin:0 auto 4px}.status{min-height:20px;margin:8px 0;color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.success{color:var(--vscode-testing-iconPassed)}
.actions{display:grid;gap:8px;margin-top:12px}.field{display:grid;gap:5px;margin:0 0 12px}.field label{font-weight:600}.field input{width:100%;height:36px;padding:7px 9px;border:1px solid var(--vscode-input-border,transparent);border-radius:4px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);font:inherit}.field input::placeholder{color:var(--vscode-input-placeholderForeground)}
.code-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}.code-row button{white-space:nowrap;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.agreement{display:flex;align-items:flex-start;gap:7px;margin:4px 0 12px;color:var(--vscode-descriptionForeground);font-size:12px}.agreement input{margin:3px 0 0;accent-color:var(--vscode-focusBorder)}.legal{min-height:auto;padding:0;border:0;color:var(--vscode-textLink-foreground);background:transparent;font-size:inherit}.legal:hover{text-decoration:underline}
.verification{margin:10px 0;padding:10px;border:1px solid var(--vscode-inputValidation-warningBorder);border-radius:6px;background:var(--vscode-inputValidation-warningBackground);color:var(--vscode-inputValidation-warningForeground)}.verification strong{display:block;margin-bottom:4px}.verification button{margin-top:8px}.privacy-note{margin:10px 0 0;font-size:12px}.advanced{display:grid;gap:5px;margin-top:12px;padding-top:10px;border-top:1px solid var(--vscode-widget-border)}
.spinner{display:none;width:20px;height:20px;margin:14px auto;border:2px solid var(--vscode-widget-border);border-top-color:var(--vscode-progressBar-background);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style></head><body>
<main class="card">
  <div class="brand">
    <svg class="tomato" viewBox="0 0 24 24" role="img" aria-label="番茄"><circle cx="13" cy="14" r="8.6" fill="#f5311d"/><path fill="#3c9d3c" d="M10.5 4.8C8.9 2.7 6.9 1.5 4.5.7c.1 2.4.7 4.4 1.8 5.9C4.1 6.3 2.2 7 .7 8.6c2.5.8 4.7.7 6.4.2-.7 1.8-.9 3.6-.5 5.3 1.8-1 3.1-2.3 3.8-3.9.7 2.2 1.9 4 3.7 5.2.4-2.5 0-4.7-1-6.4 2.4.6 4.6.3 6.5-1-1.6-1.7-3.6-2.5-5.8-2.3C15.2 4 15.7 2.1 15.5 0c-2.2 1.1-3.9 2.7-5 4.8Z"/></svg>
    <div><div class="title">登录番茄小说</div><div class="muted">使用番茄小说账号，由官网统一认证</div></div>
  </div>
  <div class="tabs" role="tablist" aria-label="登录方式">
    <button id="qrTab" class="tab" type="button" role="tab" aria-selected="true" aria-controls="qrPanel">扫码登录</button>
    <button id="phoneTab" class="tab" type="button" role="tab" aria-selected="false" aria-controls="phonePanel" tabindex="-1">验证码登录</button>
  </div>
  <section id="qrPanel" role="tabpanel" aria-labelledby="qrTab">
    <div id="intro"><p class="muted">二维码直接显示在侧边栏，请使用番茄小说 App 扫码；Safari 还会显示官方二维码窗口作为回退。</p></div>
    <div id="spinner" class="spinner"></div>
    <div id="qrWrap" class="qr-wrap" hidden><div class="qr-frame"><img id="qr" class="qr" alt="使用番茄小说 App 扫描此二维码"></div><div id="status" class="status" role="status" aria-live="polite">等待扫码</div><button id="expandQr" class="link qr-fallback" type="button">扫描不成功？点击这里试试</button></div>
    <div id="message" class="status" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="actions">
      <button id="start" class="primary" type="button">显示扫码二维码</button>
      <button id="cancel" class="secondary" type="button" hidden>取消扫码</button>
    </div>
  </section>
  <section id="phonePanel" role="tabpanel" aria-labelledby="phoneTab" hidden>
    <form id="phoneForm" novalidate>
      <div class="field">
        <label for="phone">手机号</label>
        <input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="off" maxlength="11" placeholder="请输入 11 位手机号" aria-describedby="phoneHelp">
        <span id="phoneHelp" class="muted">仅传入本次番茄官方登录会话，不会保存。</span>
      </div>
      <div class="field">
        <label for="smsCode">短信验证码</label>
        <div class="code-row">
          <input id="smsCode" name="smsCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="4 位验证码">
          <button id="sendSms" type="button">获取验证码</button>
        </div>
      </div>
      <label class="agreement" for="agreement">
        <input id="agreement" type="checkbox">
        <span>我已阅读并同意 <button class="legal" type="button" data-legal="agreement">用户协议</button> 和 <button class="legal" type="button" data-legal="privacy">隐私政策</button></span>
      </label>
      <button id="phoneLogin" class="primary" type="submit">登录 / 注册</button>
      <div id="phoneMessage" class="status" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="verification" class="verification" role="alert" hidden>
        <strong>需要完成安全验证</strong>
        <span id="verificationText">番茄要求进行滑块验证，请在官方窗口中手动完成。</span>
        <button id="openVerification" class="secondary" type="button">打开验证窗口</button>
      </div>
      <button id="cancelPhone" class="link" type="button">取消本次手机号登录</button>
      <p class="muted privacy-note">扩展不保存手机号或验证码；只保存登录成功后的 Session。不会自动破解滑块。</p>
    </form>
  </section>
  <div class="advanced">
    <button id="browser" class="secondary" type="button">打开官网统一认证窗口（备用）</button>
    <button id="manual" class="link" type="button">手动导入 Cookie（高级）</button>
  </div>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const byId=id=>document.getElementById(id);
const intro=byId('intro'),spinner=byId('spinner'),qrWrap=byId('qrWrap'),qr=byId('qr'),status=byId('status'),message=byId('message'),start=byId('start'),cancel=byId('cancel');
const qrTab=byId('qrTab'),phoneTab=byId('phoneTab'),qrPanel=byId('qrPanel'),phonePanel=byId('phonePanel'),expandQr=byId('expandQr'),phone=byId('phone'),smsCode=byId('smsCode'),agreement=byId('agreement'),sendSms=byId('sendSms'),phoneLogin=byId('phoneLogin'),phoneMessage=byId('phoneMessage'),verification=byId('verification'),openVerification=byId('openVerification');
let countdownTimer,countdownSeconds=0,qrRunning=false;
function activateTab(name,focus=true){
  const phoneActive=name==='phone';qrTab.setAttribute('aria-selected',String(!phoneActive));phoneTab.setAttribute('aria-selected',String(phoneActive));qrTab.tabIndex=phoneActive?-1:0;phoneTab.tabIndex=phoneActive?0:-1;qrPanel.hidden=phoneActive;phonePanel.hidden=!phoneActive;if(focus)(phoneActive?phoneTab:qrTab).focus();
  if(phoneActive&&qrRunning)vscode.postMessage({type:'cancelQr'});
  if(!phoneActive)vscode.postMessage({type:'cancelPhone'});
}
[qrTab,phoneTab].forEach((tab,index)=>{tab.addEventListener('click',()=>activateTab(index===0?'qr':'phone',false));tab.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();activateTab(index===0?'phone':'qr')}})});
function setPhoneMessage(text,kind='status'){phoneMessage.textContent=text||'';phoneMessage.className='status'+(kind==='error'?' error':kind==='success'?' success':'');phoneMessage.setAttribute('role',kind==='error'?'alert':'status')}
function validatePhone(){const value=phone.value.replace(/[\\s-]/g,'').replace(/^\\+?86/,'');if(!/^1[3-9]\\d{9}$/.test(value)){phone.setAttribute('aria-invalid','true');setPhoneMessage('请输入正确的 11 位中国大陆手机号。','error');phone.focus();return ''}phone.removeAttribute('aria-invalid');phone.value=value;return value}
function validateAgreement(){if(!agreement.checked){agreement.setAttribute('aria-invalid','true');setPhoneMessage('请先阅读并同意用户协议和隐私政策。','error');agreement.focus();return false}agreement.removeAttribute('aria-invalid');return true}
function setPhoneBusy(busy,action){sendSms.disabled=busy||countdownSeconds>0;phoneLogin.disabled=busy;phone.disabled=busy;smsCode.disabled=busy;agreement.disabled=busy;if(busy&&action==='sendSms')sendSms.textContent='发送中…';if(busy&&action==='submitCode')phoneLogin.textContent='登录中…'}
function startCountdown(){clearInterval(countdownTimer);countdownSeconds=60;sendSms.disabled=true;sendSms.textContent=countdownSeconds+' 秒后重试';countdownTimer=setInterval(()=>{countdownSeconds-=1;if(countdownSeconds<=0){countdownSeconds=0;clearInterval(countdownTimer);sendSms.disabled=false;sendSms.textContent='重新获取'}else sendSms.textContent=countdownSeconds+' 秒后重试'},1000)}
start.addEventListener('click',()=>vscode.postMessage({type:'startQr'}));
cancel.addEventListener('click',()=>vscode.postMessage({type:'cancelQr'}));
expandQr.addEventListener('click',()=>vscode.postMessage({type:'openQrPreview'}));
sendSms.addEventListener('click',()=>{const value=validatePhone();if(!value||!validateAgreement())return;verification.hidden=true;vscode.postMessage({type:'sendSms',phone:value,agreed:true})});
byId('phoneForm').addEventListener('submit',event=>{event.preventDefault();const value=validatePhone();if(!value||!validateAgreement())return;if(!/^\\d{4}$/.test(smsCode.value.trim())){smsCode.setAttribute('aria-invalid','true');setPhoneMessage('请输入短信中的 4 位验证码。','error');smsCode.focus();return}smsCode.removeAttribute('aria-invalid');verification.hidden=true;vscode.postMessage({type:'submitSmsCode',code:smsCode.value.trim()})});
openVerification.addEventListener('click',()=>vscode.postMessage({type:'openVerification'}));
byId('cancelPhone').addEventListener('click',()=>vscode.postMessage({type:'cancelPhone'}));
document.querySelectorAll('[data-legal]').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({type:'openLegal',kind:button.dataset.legal})));
byId('browser').addEventListener('click',()=>vscode.postMessage({type:'browserLogin'}));
byId('manual').addEventListener('click',()=>vscode.postMessage({type:'manualCookie'}));
window.addEventListener('message',({data})=>{
  if(data.type==='loading'){qrRunning=true;intro.hidden=true;spinner.style.display='block';qrWrap.hidden=true;message.textContent=data.message||'';message.className='status';message.setAttribute('role','status');start.hidden=true;cancel.hidden=false}
  if(data.type==='qrCode'){spinner.style.display='none';qr.src=data.source;qrWrap.hidden=false;message.textContent=''}
  if(data.type==='status'){status.textContent=data.message||''}
  if(data.type==='error'){qrRunning=false;spinner.style.display='none';qrWrap.hidden=true;message.textContent=data.message||'登录失败';message.className='status error';message.setAttribute('role','alert');start.textContent='重新生成二维码';start.hidden=false;cancel.hidden=true}
  if(data.type==='idle'){qrRunning=false;spinner.style.display='none';qrWrap.hidden=true;intro.hidden=false;message.textContent='';message.setAttribute('role','status');start.hidden=false;cancel.hidden=true}
  if(data.type==='phoneLoading'){setPhoneBusy(true,data.action);setPhoneMessage(data.message||'正在处理…')}
  if(data.type==='phoneStatus'){setPhoneMessage(data.message||'')}
  if(data.type==='smsSent'){setPhoneBusy(false);sendSms.textContent='获取验证码';verification.hidden=true;setPhoneMessage('验证码已发送至 '+data.phone+'，请查收短信。','success');startCountdown();smsCode.focus()}
  if(data.type==='verificationRequired'){setPhoneBusy(false);sendSms.textContent='获取验证码';phoneLogin.textContent='登录 / 注册';openVerification.disabled=false;verification.hidden=false;byId('verificationText').textContent=data.purpose==='sendSms'?'发送短信前需要完成番茄官方滑块验证。':'登录前需要完成番茄官方滑块验证。';setPhoneMessage('请打开官方验证窗口并手动完成验证。');openVerification.focus()}
  if(data.type==='verificationOpening'){setPhoneBusy(true);openVerification.disabled=true;setPhoneMessage('官方验证窗口已打开，完成滑块后会自动继续。')}
  if(data.type==='phoneError'){setPhoneBusy(false);if(countdownSeconds===0)sendSms.textContent='获取验证码';phoneLogin.textContent='登录 / 注册';openVerification.disabled=false;setPhoneMessage(data.message||'验证码登录失败。','error')}
  if(data.type==='phoneIdle'){clearInterval(countdownTimer);countdownSeconds=0;setPhoneBusy(false);sendSms.textContent='获取验证码';phoneLogin.textContent='登录 / 注册';verification.hidden=true;smsCode.value='';setPhoneMessage('本次手机号登录已取消。')}
  if(data.type==='success'){qrRunning=false;spinner.style.display='none';cancel.hidden=true;start.hidden=true;if(data.method==='phone'){setPhoneBusy(false);verification.hidden=true;phone.value='';smsCode.value='';setPhoneMessage('登录成功：'+data.name,'success')}else{status.textContent='登录成功：'+data.name}}
});
</script></body></html>`;
}

function getQrPreviewHtml(source) {
  if (!isRasterDataUri(source)) {
    throw new TypeError('二维码必须是受支持的栅格图片。');
  }
  const nonce = getNonce();
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}html,body{min-height:100%;margin:0;background:#fff;color:#111;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}body{display:grid;place-items:center;padding:32px}.preview{text-align:center}.qr-frame{display:inline-block;padding:24px;background:#fff;line-height:0}.qr{display:block;width:auto;height:auto;max-width:100%;image-rendering:crisp-edges;image-rendering:pixelated}.hint{margin:18px 0 0;font-size:15px;line-height:1.6}.hint strong{display:block;font-size:18px}
</style></head><body>
<main class="preview"><div class="qr-frame"><img id="qr" class="qr" src="${source}" alt="使用番茄小说 App 扫描此二维码"></div><p class="hint"><strong>请使用番茄小说 App 扫码</strong>保持手机镜头与屏幕平行；若有反光，可适当提高屏幕亮度。</p></main>
<script nonce="${nonce}">
const qr=document.getElementById('qr');
function fitQr(){if(!qr.naturalWidth)return;const available=Math.max(160,Math.min(520,window.innerWidth-112,window.innerHeight-180));const integerScale=Math.max(1,Math.min(4,Math.floor(available/qr.naturalWidth)));qr.style.width=Math.min(available,qr.naturalWidth*integerScale)+'px';qr.style.height='auto'}
qr.addEventListener('load',fitQr);window.addEventListener('resize',fitQr);if(qr.complete)fitQr();
</script></body></html>`;
}

function isRasterDataUri(source) {
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(source || '');
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

module.exports = { LoginViewProvider, getLoginHtml, getQrPreviewHtml, isRasterDataUri };
