const {EventEmitter} = ChromeUtils.import('resource://gre/modules/EventEmitter.jsm');
const {Helper} = ChromeUtils.import('chrome://juggler/content/Helper.js');
const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const helper = new Helper();

class TargetRegistry {
  constructor(mainWindow, contextManager) {
    EventEmitter.decorate(this);

    this._mainWindow = mainWindow;
    this._contextManager = contextManager;
    this._targets = new Map();
    this._tabToTarget = new Map();

    for (const tab of this._mainWindow.gBrowser.tabs)
      this._ensureTargetForTab(tab);
    this._mainWindow.gBrowser.tabContainer.addEventListener('TabOpen', event => {
      this._ensureTargetForTab(event.target);
    });
    this._mainWindow.gBrowser.tabContainer.addEventListener('TabClose', event => {
      const tab = event.target;
      const target = this._tabToTarget.get(tab);
      if (!target)
        return;
      this._targets.delete(target.id());
      this._tabToTarget.delete(tab);
      target._onClosed();
      this.emit(TargetRegistry.Events.TargetDestroyed, target);
    });
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
    const target = this._ensureTargetForTab(tab);
    return target;
  }

  target(targetId) {
    return this._targets.get(targetId) || null;
  }

  targets() {
    return Array.from(this._targets.values());
  }

  _ensureTargetForTab(tab) {
    if (this._tabToTarget.has(tab))
      return this._tabToTarget.get(tab);
    const openerTarget = tab.openerTab ? this._ensureTargetForTab(tab.openerTab) : null;
    const target = new PageTarget(this, tab, this._contextManager.browserContextId(tab.userContextId), openerTarget);

    this._targets.set(target.id(), target);
    this._tabToTarget.set(tab, target);
    this.emit(TargetRegistry.Events.TargetCreated, target);
  }
}

let lastTabTargetId = 0;

class PageTarget {
  constructor(registry, tab, browserContextId, opener) {
    this._targetId = 'target-page-' + (++lastTabTargetId);
    this._registry = registry;
    this._tab = tab;
    this._browserContextId = browserContextId;
    this._openerId = opener ? opener.id() : undefined;
    this._url = tab.linkedBrowser.currentURI.spec;
    this._closed = false;

    // First navigation always happens to about:blank - do not report it.
    this._skipNextNavigation = true;

    const navigationListener = {
      QueryInterface: ChromeUtils.generateQI([ Ci.nsIWebProgressListener]),
      onLocationChange: (aWebProgress, aRequest, aLocation) => this._onNavigated(aLocation),
    };
    this._eventListeners = [
      helper.addProgressListener(tab.linkedBrowser, navigationListener, Ci.nsIWebProgress.NOTIFY_LOCATION),
    ];
  }

  url() {
    return this._url;
  }

  type() {
    return 'page';
  }

  tab() {
    return this._tab;
  }

  id() {
    return this._targetId;
  }

  openerId() {
    return this._openerId;
  }

  browserContextId() {
    return this._browserContextId;
  }

  _onNavigated(aLocation) {
    if (this._skipNextNavigation) {
      this._skipNextNavigation = false;
      return;
    }
    this._url = aLocation.spec;
    this._registry.emit(TargetRegistry.Events.TargetChanged, this);
  }

  async close({runBeforeUnload}) {
    if (this._closed)
      return;
    this._closed = true;
    await this._registry._mainWindow.gBrowser.removeTab(this._tab, {
      skipPermitUnload: !runBeforeUnload,
    });
  }

  _onClosed() {
    this._closed = true;
    helper.removeListeners(this._eventListeners);
  }
}

TargetRegistry.Events = {
  TargetCreated: Symbol('TargetRegistry.Events.TargetCreated'),
  TargetDestroyed: Symbol('TargetRegistry.Events.TargetDestroyed'),
  TargetChanged: Symbol('TargetRegistry.Events.TargetChanged'),
};

var EXPORTED_SYMBOLS = ['TargetRegistry'];
this.TargetRegistry = TargetRegistry;
