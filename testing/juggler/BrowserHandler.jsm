"use strict";

const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");
const {PageHandler} = ChromeUtils.import("chrome://juggler/content/PageHandler.jsm");
const {InsecureSweepingOverride} = ChromeUtils.import("chrome://juggler/content/InsecureSweepingOverride.js");

class BrowserHandler {
  /**
   * @param {ChromeSession} session
   * @param {Ci.nsIDOMChromeWindow} mainWindow
   * @param {BrowserContextManager} contextManager
   * @param {NetworkObserver} networkObserver
   */
  constructor(session, mainWindow, contextManager, networkObserver) {
    this._session = session;
    this._mainWindow = mainWindow;
    this._contextManager = contextManager;
    this._networkObserver = networkObserver;
    this._pageHandlers = new Map();
    this._tabsToPageHandlers = new Map();
    this._enabled = false;
    this._sweepingOverride = null;
  }

  async setIgnoreHTTPSErrors({enabled}) {
    if (!enabled && this._sweepingOverride) {
      this._sweepingOverride.unregister();
      this._sweepingOverride = null;
      Services.prefs.setBoolPref('security.mixed_content.block_active_content', true);
    } else if (enabled && !this._sweepingOverride) {
      this._sweepingOverride = new InsecureSweepingOverride();
      this._sweepingOverride.register();
      Services.prefs.setBoolPref('security.mixed_content.block_active_content', false);
    }
  }

  async getInfo() {
    const version = Components.classes["@mozilla.org/xre/app-info;1"]
                              .getService(Components.interfaces.nsIXULAppInfo)
                              .version;
    const userAgent = Components.classes["@mozilla.org/network/protocol;1?name=http"]
                                .getService(Components.interfaces.nsIHttpProtocolHandler)
                                .userAgent;
    return {version: 'Firefox/' + version, userAgent};
  }

  async createBrowserContext() {
    return {browserContextId: this._contextManager.createBrowserContext()};
  }

  async removeBrowserContext({browserContextId}) {
    this._contextManager.removeBrowserContext(browserContextId);
  }

  async getBrowserContexts() {
    return {browserContextIds: this._contextManager.getBrowserContexts()};
  }

  async enable() {
    if (this._enabled)
      return;
    this._enabled = true;
    const tabs = this._mainWindow.gBrowser.tabs;
    for (const tab of this._mainWindow.gBrowser.tabs)
      this._ensurePageHandler(tab);
    this._mainWindow.gBrowser.tabContainer.addEventListener('TabOpen', event => {
      this._ensurePageHandler(event.target);
    });
    this._mainWindow.gBrowser.tabContainer.addEventListener('TabClose', event => {
      this._removePageHandlerForTab(event.target);
    });
  }

  pageForId(pageId) {
    return this._pageHandlers.get(pageId) || null;
  }

  _ensurePageHandler(tab) {
    if (this._tabsToPageHandlers.has(tab))
      return this._tabsToPageHandlers.get(tab);
    const pageHandler = new PageHandler(this._session, tab, this._networkObserver);
    this._pageHandlers.set(pageHandler.id(), pageHandler);
    this._tabsToPageHandlers.set(tab, pageHandler);

    const openerHandler = tab.openerTab ? this._ensurePageHandler(tab.openerTab) : null;
    this._session.emitEvent('Browser.tabOpened', {
      url: pageHandler.url(),
      pageId: pageHandler.id(),
      browserContextId: this._contextManager.browserContextId(tab.userContextId),
      openerId: openerHandler ? openerHandler.id() : undefined,
    });
    return pageHandler;
  }

  _removePageHandlerForTab(tab) {
    const pageHandler = this._tabsToPageHandlers.get(tab);
    this._tabsToPageHandlers.delete(tab);
    this._pageHandlers.delete(pageHandler.id());
    pageHandler.dispose();
    this._session.emitEvent('Browser.tabClosed', {pageId: pageHandler.id()});
  }

  async newPage({browserContextId}) {
    const tab = this._mainWindow.gBrowser.addTab('about:blank', {
      userContextId: this._contextManager.userContextId(browserContextId),
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    this._mainWindow.gBrowser.selectedTab = tab;
    // Await navigation to about:blank
    await new Promise(resolve => {
      const wpl = {
        onLocationChange: function(aWebProgress, aRequest, aLocation) {
          tab.linkedBrowser.removeProgressListener(wpl);
          resolve();
        },
        QueryInterface: ChromeUtils.generateQI([
          Ci.nsIWebProgressListener,
          Ci.nsISupportsWeakReference,
        ]),
      };
      tab.linkedBrowser.addProgressListener(wpl);
    });
    const pageHandler = this._ensurePageHandler(tab);
    return {pageId: pageHandler.id()};
  }

  async closePage({pageId}) {
    const pageHandler = this._pageHandlers.get(pageId);
    await this._mainWindow.gBrowser.removeTab(pageHandler.tab());
  }
}

var EXPORTED_SYMBOLS = ['BrowserHandler'];
this.BrowserHandler = BrowserHandler;
