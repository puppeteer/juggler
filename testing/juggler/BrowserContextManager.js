"use strict";

const {ContextualIdentityService} = ChromeUtils.import("resource://gre/modules/ContextualIdentityService.jsm");
const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");
const {NetUtil} = ChromeUtils.import('resource://gre/modules/NetUtil.jsm');

const IDENTITY_NAME = 'JUGGLER ';

const ALL_PERMISSIONS = [
  'geo',
  'microphone',
  'camera',
  'desktop-notifications',
];

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

  grantPermissions(browserContextId, origin, permissions) {
    dump(`
      Granting ${JSON.stringify(permissions)} for: "${browserContextId}"
    `);
    const attrs = browserContextId ? {userContextId: this.userContextId(browserContextId)} : {};
    dump(`
      attrs: ${JSON.stringify(attrs)}
    `);
    const principal = Services.scriptSecurityManager.createCodebasePrincipal(NetUtil.newURI(origin), attrs);
    for (const permission of ALL_PERMISSIONS) {
      const action = permissions.includes(permission) ? Ci.nsIPermissionManager.ALLOW_ACTION : Ci.nsIPermissionManager.DENY_ACTION;
      Services.perms.addFromPrincipal(principal, permission, action);
    }
  }

  resetPermissions(browserContextId) {
    dump(`
      Resetting for: "${browserContextId}"
    `);
    const attrs = browserContextId ? {userContextId: this.userContextId(browserContextId)} : {};
    dump(`
      attrs: ${JSON.stringify(attrs)}
    `);
    Services.perms.removePermissionsWithAttributes(JSON.stringify(attrs));
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

