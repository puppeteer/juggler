"use strict";

const {ContextualIdentityService} = ChromeUtils.import("resource://gre/modules/ContextualIdentityService.jsm");

const IDENTITY_NAME = 'JUGGLER ';

class BrowserContextManager {
  static instance() {
    return BrowserContextManager._instance || null;
  }

  static initialize() {
    if (BrowserContextManager._instance)
      return;
    BrowserContextManager._instance = new BrowserContextManager();
  }

  constructor() {
    this._id = 0;
    this._browserContextIdToUserContextId = new Map();
    this._userContextIdToBrowserContextId = new Map();
    // Cleanup containers from previous runs (if any)
    for (const identity of ContextualIdentityService.getPublicIdentities()) {
      if (identity.name && identity.name.startsWith(IDENTITY_NAME)) {
        ContextualIdentityService.remove(identity.userContextId);
        ContextualIdentityService.closeContainerTabs(identity.userContextId);
      }
    }
  }

  createBrowserContext() {
    const browserContextId = (++this._id) + '';
    const identity = ContextualIdentityService.create(IDENTITY_NAME + browserContextId);
    this._browserContextIdToUserContextId.set(browserContextId, identity.userContextId);
    this._userContextIdToBrowserContextId.set(identity.userContextId, browserContextId);
    return browserContextId;
  }

  browserContextId(userContextId) {
    return this._userContextIdToBrowserContextId.get(userContextId);
  }

  userContextId(browserContextId) {
    return this._browserContextIdToUserContextId.get(browserContextId);
  }

  removeBrowserContext(browserContextId) {
    const userContextId = this._browserContextIdToUserContextId.get(browserContextId);
    ContextualIdentityService.remove(userContextId);
    ContextualIdentityService.closeContainerTabs(userContextId);
    this._browserContextIdToUserContextId.delete(browserContextId);
    this._userContextIdToBrowserContextId.delete(userContextId);
  }

  getBrowserContexts() {
    return Array.from(this._browserContextIdToUserContextId.keys());
  }
}

var EXPORTED_SYMBOLS = ['BrowserContextManager'];
this.BrowserContextManager = BrowserContextManager;

